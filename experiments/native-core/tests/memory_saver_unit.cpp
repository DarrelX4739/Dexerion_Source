#include "dexerion/memory_saver.hpp"

#include <iostream>
#include <limits>
#include <stdexcept>
#include <vector>

namespace ms = dexerion::memory_saver;

static void require(bool outcome, const char* message) {
  if (!outcome) throw std::logic_error(message);
}

int main() {
  try {
    require(ms::clamp_cap_mb(std::numeric_limits<double>::quiet_NaN()) == ms::kCapDefaultMb, "NaN cap");
    require(ms::clamp_cap_mb(std::numeric_limits<double>::infinity()) == ms::kCapDefaultMb, "infinite cap");
    require(ms::clamp_cap_mb(1700.75) == 1700 && ms::clamp_cap_mb(-1) == 1024, "cap clamp");
    require(ms::hog_floor_mb(1202) == 301 && ms::hog_floor_mb(1024) == 300, "warning floor");
    require(!ms::should_notice_hog(800, 2048, 0) && ms::should_notice_hog(512, 2048, 1), "warning gate");

    ms::TabSnapshot t;
    t.has_view = true; t.last_active_ms = 1000; t.memory_mb = 300; t.pid = 5;
    require(!ms::eligible(t, 60'999) && ms::eligible(t, 61'000), "idle threshold");
    t.url = "dexerion://blocked/lesson";
    require(!ms::eligible(t, 70'000), "Focus-protected tab cannot sleep");
    t.url = "https://example.test/";
    std::vector<ms::TabSnapshot> tabs(3, t);
    tabs[0].active = true; tabs[1].last_active_ms = 2000; tabs[2].last_active_ms = 1000;
    const auto plan = ms::plan_sweep(tabs, {1800, 1536, 100'000});
    require(plan.victims == std::vector<std::size_t>{2, 1}, "protected shared sibling / victim order");
    require(plan.projected_mb == 1500 && plan.over_mb == 264, "process credited once");
    const auto no_op = ms::plan_sweep(tabs, {1536, 1536, 100'000});
    require(no_op.victims.empty() && no_op.over_mb == 0 && no_op.projected_mb == 1536, "under budget");
    std::cout << "PASS native Memory Saver contracts\n";
  } catch (const std::exception& e) {
    std::cerr << "FAIL: " << e.what() << '\n';
    return 1;
  }
  return 0;
}
