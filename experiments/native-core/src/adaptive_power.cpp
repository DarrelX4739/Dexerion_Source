#include "dexerion/adaptive_power.hpp"

#include <algorithm>
#include <cmath>

namespace dexerion::adaptive_power {

std::string_view name(Tier tier) noexcept {
  switch (tier) {
    case Tier::suspended: return "suspended";
    case Tier::minimal: return "minimal";
    case Tier::balanced: return "balanced";
    case Tier::accelerated: return "accelerated";
  }
  return {};
}

std::optional<Tier> tier_from_name(std::string_view value) noexcept {
  for (const auto t : {Tier::suspended, Tier::minimal, Tier::balanced, Tier::accelerated}) {
    if (name(t) == value) return t;
  }
  return std::nullopt;
}

bool needs_gpu_mode_migration(std::string_view mode) noexcept { return mode != kGpuMode; }

GpuStartup startup_gpu_plan(bool on_battery, double free_mem_mb, std::string_view override_mode) noexcept {
  if (override_mode == "off") return {true, false, false, false, 0, Tier::suspended, true};
  const bool conservative = on_battery || (free_mem_mb > 0 && free_mem_mb < 2048);
  return {false, !conservative, true, false, conservative ? 256 : 512,
          conservative ? Tier::minimal : Tier::balanced, false};
}

int demand_score(const Signals& s) noexcept {
  return 5 * s.webgl + 5 * s.video + 2 * s.animation + 2 * s.interacting +
         s.loading + (s.active_tab_count > 1) + s.audible;
}

Tier desired_tier(const Signals& s) noexcept {
  const int score = demand_score(s);
  if (score < 2) return Tier::minimal;
  if (score < 5) return Tier::balanced;
  const bool constrained = s.on_battery || (s.free_mem_mb > 0 && s.free_mem_mb < 1024) ||
                           s.cpu_pct >= 75;
  return constrained && score < 7 ? Tier::balanced : Tier::accelerated;
}

Tier decide_gpu_tier(const Signals& s, std::optional<Tier> previous, double now_ms,
                     std::optional<double> tier_since_ms) noexcept {
  if (s.locked || s.minimized ||
      (s.idle_ms >= kSuspendIdleMs && !s.video && !s.audible && !s.webgl)) return Tier::suspended;
  const auto desired = desired_tier(s);
  const double age = tier_since_ms && std::isfinite(*tier_since_ms)
      ? std::max(0.0, now_ms - *tier_since_ms) : kDowngradeHysteresisMs;
  if (previous && desired < *previous && age < kDowngradeHysteresisMs) return *previous;
  return desired;
}

RuntimePlan runtime_plan(const Signals& s, std::optional<Tier> previous, double now_ms,
                         std::optional<double> tier_since_ms, const Budgets& b) noexcept {
  const auto tier = decide_gpu_tier(s, previous, now_ms, tier_since_ms);
  const bool suspended = tier == Tier::suspended;
  const int multiplier = suspended ? 3 : (s.on_battery || s.idle_ms >= 120000 ? 2 : 1);
  const bool deep_idle = suspended && !s.focused && !s.video && !s.audible && !s.webgl &&
                         !s.loading && !s.interacting;
  const double base_sweep = b.sweep_interval_ms == 0 ? 60000 : b.sweep_interval_ms;
  const double base_idle = b.idle_sleep_ms == 0 ? 180000 : b.idle_sleep_ms;
  constexpr double max_sweep = 300000;
  // Mirror Math.round(n) for finite normalized budgets (ties toward +infinity).
  const double deep_ceiling = std::floor(b.sweep_deep_idle_ms + 0.5);
  double sweep = std::clamp(base_sweep * multiplier, 15000.0, max_sweep);
  if (deep_idle && deep_ceiling > max_sweep) sweep = std::max(sweep, deep_ceiling);
  double idle = suspended || s.on_battery ? std::min(base_idle, 90000.0) : base_idle;
  if (s.free_mem_mb > 0 && s.free_mem_mb < 1024) idle = std::min(idle, 60000.0);
  return {tier, std::floor(sweep + 0.5), deep_idle, std::floor(idle + 0.5),
          true, true, true, !suspended};
}

}  // namespace dexerion::adaptive_power
