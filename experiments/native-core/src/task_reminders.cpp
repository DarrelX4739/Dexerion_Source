#include "dexerion/task_reminders.hpp"
#include "dexerion/js_number.hpp"

#include <algorithm>
#include <cmath>
#include <set>
#include <string_view>
#include <tuple>

namespace dexerion::task_reminders {

Reminder reminder_kind(const Task& t, double now_ms) noexcept {
  if (t.done || !std::isfinite(now_ms)) return Reminder::none;
  if (!t.reminded_due && now_ms >= t.due_ms) return Reminder::due;
  if (!t.reminded_pre && now_ms >= t.due_ms - kPreNotifyMs && now_ms < t.due_ms) return Reminder::pre;
  return Reminder::none;
}

std::optional<double> next_reminder_at(const Task& t, double now_ms) noexcept {
  if (t.done || !std::isfinite(now_ms) || !std::isfinite(t.due_ms) || t.due_ms <= 0 ||
      (t.reminded_pre && t.reminded_due)) return std::nullopt;
  // The pre-notification precedes the due timestamp, so if both are pending
  // there is no need to allocate a list/heap for the two candidates.
  return std::max(now_ms, t.reminded_pre ? t.due_ms : t.due_ms - kPreNotifyMs);
}

namespace {
bool ordered(const Task& a, const Task& b) {
  return std::tie(a.done, a.due_ms, a.priority, a.created_at_ms, a.id) <
         std::tie(b.done, b.due_ms, b.priority, b.created_at_ms, b.id);
}
}  // namespace

std::vector<std::size_t> sort_tasks(const std::vector<Task>& tasks) {
  std::set<std::u16string_view> seen;
  std::vector<std::size_t> rows;
  for (std::size_t i = 0; i < tasks.size(); ++i) {
    if (seen.insert(tasks[i].id).second) rows.push_back(i);  // first duplicate wins
  }
  std::sort(rows.begin(), rows.end(), [&](auto i, auto j) {
    return ordered(tasks[i], tasks[j]);
  });
  return rows;
}

std::vector<std::size_t> next_three(const std::vector<Task>& tasks) {
  // The rail never consumes a fourth entry. Keep only three ordered
  // candidates instead of making and sorting a second complete index list.
  std::set<std::u16string_view> seen;
  std::vector<std::size_t> best;
  best.reserve(3);
  for (std::size_t i = 0; i < tasks.size(); ++i) {
    if (!seen.insert(tasks[i].id).second || tasks[i].done) continue;
    const auto pos = std::lower_bound(best.begin(), best.end(), i, [&](auto a, auto b) {
      return ordered(tasks[a], tasks[b]);
    }) - best.begin();
    if (best.size() == 3) {
      if (pos == 3) continue;
      best.pop_back();
    }
    best.insert(best.begin() + pos, i);
  }
  return best;
}

double heartbeat_ms(const std::vector<Task>& tasks, double now_ms, const HeartbeatBudget& b) {
  const double fast = std::max(1000.0, detail::js_round(b.fast_ms == 0 ? 30000 : b.fast_ms));
  const double slow = std::max(fast, detail::js_round(b.slow_ms == 0 ? 300000 : b.slow_ms));
  if (!b.near_window_ms) return slow;
  const double near = std::max(0.0, detail::js_round(*b.near_window_ms));
  if (near <= 0) return fast;  // legacy fixed heartbeat
  std::set<std::u16string_view> seen;
  for (const auto& t : tasks) {
    if (!seen.insert(t.id).second) continue;
    const auto next = next_reminder_at(t, now_ms);
    if (next && *next - now_ms <= near) return fast;
  }
  return slow;
}

}  // namespace dexerion::task_reminders
