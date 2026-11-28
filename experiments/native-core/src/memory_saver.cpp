#include "dexerion/memory_saver.hpp"

#include <algorithm>
#include <cmath>
#include <map>
#include <string_view>
#include <unordered_map>
#include <utility>

namespace dexerion::memory_saver {

int clamp_cap_mb(double value) noexcept {
  if (!std::isfinite(value)) return kCapDefaultMb;
  return static_cast<int>(std::clamp(std::floor(value), double{kCapMinMb}, double{kCapMaxMb}));
}

double hog_floor_mb(double cap_mb) noexcept {
  return std::max(300.0, std::floor(cap_mb * 0.25 + 0.5));
}

bool should_notice_hog(double active_mb, double cap_mb, double over_mb) noexcept {
  return over_mb > 0 && active_mb >= hog_floor_mb(cap_mb);
}

bool eligible(const TabSnapshot& tab, double now_ms, double floor_ms) noexcept {
  constexpr std::string_view blocked = "dexerion://blocked";
  return tab.has_view && !tab.active && !tab.loading && !tab.lazy && !tab.sleeping &&
         !tab.audible && tab.url.compare(0, blocked.size(), blocked) != 0 &&
         now_ms - tab.last_active_ms >= floor_ms;
}

SweepPlan plan_sweep(const std::vector<TabSnapshot>& tabs, const SweepInput& input) {
  SweepPlan plan{{}, input.total_mb, 0};
  if (input.cap_mb <= 0 || input.total_mb <= input.cap_mb) return plan;
  plan.over_mb = input.total_mb - input.cap_mb;

  using Group = std::vector<std::size_t>;
  std::vector<Group> groups;
  std::unordered_map<std::int32_t, std::size_t> by_pid;
  std::map<std::pair<std::int32_t, std::string_view>, std::size_t> without_pid;
  for (std::size_t i = 0; i < tabs.size(); ++i) {
    const auto& t = tabs[i];
    if (!eligible(t, input.now_ms, input.floor_ms)) continue;
    // The two namespaces are disjoint. Keep inserting groups into the vector
    // in first-seen order: iteration order of either map must never break LRU ties.
    const auto group_index = t.pid != 0
        ? by_pid.try_emplace(t.pid, groups.size()).first->second
        : without_pid.try_emplace(std::make_pair(t.window_id, std::string_view(t.tab_id)),
                                  groups.size()).first->second;
    if (group_index == groups.size()) groups.emplace_back();
    groups[group_index].push_back(i);
  }
  for (auto& g : groups) {
    std::stable_sort(g.begin(), g.end(), [&](auto a, auto b) {
      return tabs[a].last_active_ms < tabs[b].last_active_ms;
    });
  }
  std::stable_sort(groups.begin(), groups.end(), [&](const Group& a, const Group& b) {
    const auto& x = tabs[a.front()];
    const auto& y = tabs[b.front()];
    if (x.memory_mb != y.memory_mb) return x.memory_mb > y.memory_mb;
    return x.last_active_ms < y.last_active_ms;
  });
  for (const auto& g : groups) {
    if (plan.projected_mb <= input.cap_mb) break;
    plan.victims.insert(plan.victims.end(), g.begin(), g.end());
    // Like the JS policy, credit the oldest eligible member's renderer estimate
    // once. A protected sibling will not be slept, even if it shares that PID.
    plan.projected_mb -= tabs[g.front()].memory_mb;
  }
  plan.projected_mb = std::max(0.0, plan.projected_mb);
  return plan;
}

}  // namespace dexerion::memory_saver
