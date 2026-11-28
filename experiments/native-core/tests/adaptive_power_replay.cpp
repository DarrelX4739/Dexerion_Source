// Synthetic tests/benchmarks only; no OS power signals or GPU switches are read or applied.
#include "dexerion/adaptive_power.hpp"

#include <chrono>
#include <cmath>
#include <cstdint>
#include <iomanip>
#include <iostream>
#include <limits>
#include <optional>
#include <string>
#include <vector>

namespace ap = dexerion::adaptive_power;

struct Fixture {
  ap::Signals s;
  ap::Budgets budgets;
  double now{};
  std::optional<double> since;
  std::optional<ap::Tier> previous;
  std::string mode, override_mode;
};

static bool read_fixture(Fixture& f) {
  std::string previous;
  int has_since = 0;
  unsigned flags = 0;
  double since = 0;
  if (!(std::cin >> flags >> f.s.idle_ms >> f.s.free_mem_mb >> f.s.cpu_pct >> f.s.active_tab_count >>
      f.now >> has_since >> since >> previous >> f.mode >> f.override_mode >>
      f.budgets.sweep_interval_ms >> f.budgets.idle_sleep_ms >> f.budgets.sweep_deep_idle_ms)) return false;
  if (flags >= 1024 || (has_since != 0 && has_since != 1)) return false;
  for (double v : {f.s.idle_ms, f.s.free_mem_mb, f.s.cpu_pct, f.now, since,
        f.budgets.sweep_interval_ms, f.budgets.idle_sleep_ms, f.budgets.sweep_deep_idle_ms}) {
    if (!std::isfinite(v)) return false;
  }
  f.s.focused = flags & 1; f.s.minimized = flags & 2; f.s.locked = flags & 4;
  f.s.on_battery = flags & 8; f.s.video = flags & 16; f.s.webgl = flags & 32;
  f.s.animation = flags & 64; f.s.loading = flags & 128; f.s.audible = flags & 256;
  f.s.interacting = flags & 512;
  f.previous = ap::tier_from_name(previous);
  if (has_since) f.since = since;
  return true;
}

static ap::RuntimePlan runtime(const Fixture& f) {
  return ap::runtime_plan(f.s, f.previous, f.now, f.since, f.budgets);
}

static void print_parity(const Fixture& f) {
  const auto boot = ap::startup_gpu_plan(f.s.on_battery, f.s.free_mem_mb, f.override_mode);
  const auto p = runtime(f);
  std::cout << ap::kGpuMode << ' ' << ap::needs_gpu_mode_migration(f.mode) << ' '
            << boot.disable_gpu << ' ' << boot.gpu_rasterization << ' ' << boot.zero_copy << ' '
            << boot.force_low_power_gpu << ' ' << boot.gpu_memory_mb << ' ' << ap::name(boot.tier) << ' '
            << (boot.override_off ? "off" : "-") << ' ' << ap::demand_score(f.s) << ' '
            << ap::name(ap::desired_tier(f.s)) << ' ' << ap::name(p.gpu_tier) << ' '
            << p.sweep_interval_ms << ' ' << p.deep_idle_sweep << ' ' << p.idle_sleep_ms << ' '
            << p.hide_inactive_views << ' ' << p.hide_minimized_views << ' '
            << p.background_throttling << ' ' << p.sample_metrics << '\n';
}

// Unsigned addition is intentionally modulo 2^32; all benchmark fixtures use
// non-negative timings. Check output-dependent work before trusting measurements.
static std::uint32_t run_pass(const std::vector<Fixture>& rows) {
  std::uint32_t sum = 0;
  for (const auto& f : rows) {
    const auto p = runtime(f);
    sum += static_cast<std::uint32_t>(p.sweep_interval_ms) +
           static_cast<std::uint32_t>(p.idle_sleep_ms) +
           static_cast<std::uint32_t>(p.gpu_tier) +
           static_cast<std::uint32_t>(p.deep_idle_sweep) +
           static_cast<std::uint32_t>(p.sample_metrics);
  }
  return sum;
}

int main() {
  std::string mode;
  int count = 0, passes = 0;
  if (!(std::cin >> mode >> count >> passes) || count < 0 || count > 50000 ||
      passes < 1 || passes > 1000 || (mode != "replay" && mode != "bench")) return 2;
  std::vector<Fixture> rows(static_cast<std::size_t>(count));
  for (auto& f : rows) if (!read_fixture(f)) return 2;
  std::cout << std::setprecision(17);
  if (mode == "replay") {
    for (const auto& f : rows) print_parity(f);
  } else {
    // Validate conversion bounds outside timing; malformed manual benchmark
    // inputs must not cause an out-of-range floating-to-unsigned conversion.
    constexpr double max_counter = std::numeric_limits<std::uint32_t>::max();
    for (const auto& f : rows) {
      const auto r = runtime(f);
      if (!(r.sweep_interval_ms >= 0 && r.sweep_interval_ms <= max_counter &&
            r.idle_sleep_ms >= 0 && r.idle_sleep_ms <= max_counter)) return 2;
    }
    // Warm the exact same fixture set before timing. Publish this checksum too
    // so the compiler cannot remove the warm-up as unused.
    const auto warm = run_pass(rows);
    const auto start = std::chrono::steady_clock::now();
    std::uint32_t sum = 0;
    for (int i = 0; i < passes; ++i) sum += run_pass(rows);
    const auto end = std::chrono::steady_clock::now();
    std::cout << warm << ' ' << sum << ' '
              << std::chrono::duration<double, std::milli>(end - start).count() << '\n';
  }
}
