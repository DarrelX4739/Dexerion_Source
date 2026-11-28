#pragma once

#include <optional>
#include <string_view>

namespace dexerion::adaptive_power {

enum class Tier { suspended, minimal, balanced, accelerated };
std::string_view name(Tier tier) noexcept;
std::optional<Tier> tier_from_name(std::string_view value) noexcept;

inline constexpr double kDowngradeHysteresisMs = 15000;
inline constexpr double kSuspendIdleMs = 600000;

struct Signals {
  bool focused{true}, minimized{}, locked{}, on_battery{};
  double idle_ms{}, free_mem_mb{}, cpu_pct{};
  int active_tab_count{1};
  bool video{}, webgl{}, animation{}, loading{}, audible{}, interacting{};
};

struct Budgets {
  double sweep_interval_ms{60000}, idle_sleep_ms{180000}, sweep_deep_idle_ms{};
};

struct GpuStartup {
  bool disable_gpu{}, gpu_rasterization{}, zero_copy{}, force_low_power_gpu{};
  int gpu_memory_mb{};
  Tier tier{Tier::suspended};
  bool override_off{};
  // Every persisted GPU mode normalizes to "adaptive"; no launch flags are applied here.
};

struct RuntimePlan {
  Tier gpu_tier;
  double sweep_interval_ms;
  bool deep_idle_sweep;
  double idle_sleep_ms;
  bool hide_inactive_views, hide_minimized_views, background_throttling, sample_metrics;
};

inline constexpr std::string_view kGpuMode = "adaptive";
bool needs_gpu_mode_migration(std::string_view mode) noexcept;
GpuStartup startup_gpu_plan(bool on_battery, double free_mem_mb, std::string_view override_mode = {}) noexcept;
int demand_score(const Signals& s) noexcept;
Tier desired_tier(const Signals& s) noexcept;
Tier decide_gpu_tier(const Signals& s, std::optional<Tier> previous,
                     double now_ms, std::optional<double> tier_since_ms) noexcept;
RuntimePlan runtime_plan(const Signals& s, std::optional<Tier> previous, double now_ms,
                         std::optional<double> tier_since_ms, const Budgets& budgets = {}) noexcept;

}  // namespace dexerion::adaptive_power
