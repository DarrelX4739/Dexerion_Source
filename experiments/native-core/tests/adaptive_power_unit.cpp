#include "dexerion/adaptive_power.hpp"

#include <iostream>
#include <stdexcept>

namespace ap = dexerion::adaptive_power;

static void require(bool outcome, const char* message) {
  if (!outcome) throw std::logic_error(message);
}

int main() {
  try {
    using ap::Tier;
    ap::Signals s;
    const auto boot = ap::startup_gpu_plan(false, 2048);
    require(!boot.disable_gpu && boot.gpu_rasterization && boot.zero_copy && boot.gpu_memory_mb == 512, "boot");
    require(!ap::startup_gpu_plan(false, 2047).gpu_rasterization, "low memory boot");
    require(ap::startup_gpu_plan(false, 4096, "off").override_off, "test override");
    require(ap::needs_gpu_mode_migration("full") && !ap::needs_gpu_mode_migration("adaptive"), "migration");
    require(ap::tier_from_name("accelerated") == Tier::accelerated && !ap::tier_from_name("unknown"), "tier labels");
    s.video = true; s.on_battery = true;
    require(ap::demand_score(s) == 5 && ap::desired_tier(s) == Tier::balanced, "battery caps moderate demand");
    s.interacting = true;
    require(ap::desired_tier(s) == Tier::accelerated, "interactive video reaches accelerated");
    s = {};
    require(ap::decide_gpu_tier(s, Tier::accelerated, 14999, 0) == Tier::accelerated, "short dip");
    require(ap::decide_gpu_tier(s, Tier::accelerated, 15000, 0) == Tier::minimal, "hysteresis expiry");
    s.locked = true; s.focused = false; s.free_mem_mb = 512;
    auto p = ap::runtime_plan(s, Tier::accelerated, 15000, 14999, {60000, 180000, 600000});
    require(p.gpu_tier == Tier::suspended && p.deep_idle_sweep && p.sweep_interval_ms == 600000 &&
            p.idle_sleep_ms == 60000 && !p.sample_metrics, "quiet locked system");
    s.loading = true;
    p = ap::runtime_plan(s, {}, 15000, {}, {60000, 180000, 600000});
    require(!p.deep_idle_sweep && p.sweep_interval_ms == 180000, "do not stretch a busy system");
    std::cout << "PASS native Adaptive Power contracts\n";
  } catch (const std::exception& e) {
    std::cerr << "FAIL: " << e.what() << '\n'; return 1;
  }
  return 0;
}
