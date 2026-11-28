// Offline test adapter, never launched by Dexerion. Each case is a header
// followed by N tab records. Only synthetic, whitespace-free strings are used.
#include "dexerion/memory_saver.hpp"

#include <cmath>
#include <iomanip>
#include <iostream>
#include <string>
#include <vector>

namespace ms = dexerion::memory_saver;

int main() {
  std::cout << std::setprecision(17);
  std::string op;
  while (std::cin >> op) {
    ms::SweepInput in;
    int count = 0;
    double active_mb = 0;
    if (op != "sweep" || !(std::cin >> count >> in.total_mb >> in.cap_mb >> in.now_ms >>
          in.floor_ms >> active_mb) || count < 0 || count > 10000 ||
        !std::isfinite(in.total_mb) || !std::isfinite(in.cap_mb) ||
        !std::isfinite(in.now_ms) || !std::isfinite(in.floor_ms) || !std::isfinite(active_mb)) {
      std::cerr << "Invalid native policy fixture header\n";
      return 2;
    }
    std::vector<ms::TabSnapshot> tabs(static_cast<std::size_t>(count));
    for (auto& t : tabs) {
      unsigned flags = 0;
      if (!(std::cin >> t.window_id >> t.tab_id >> t.pid >> t.memory_mb >> t.last_active_ms >>
            flags >> t.url) || !std::isfinite(t.memory_mb) || !std::isfinite(t.last_active_ms) ||
            flags > 63) {
        std::cerr << "Invalid native policy tab record\n";
        return 2;
      }
      t.active = flags & 1; t.loading = flags & 2; t.lazy = flags & 4;
      t.sleeping = flags & 8; t.has_view = flags & 16; t.audible = flags & 32;
    }
    const auto plan = ms::plan_sweep(tabs, in);
    std::cout << plan.projected_mb << ' ' << plan.over_mb << ' ' << ms::clamp_cap_mb(in.cap_mb)
              << ' ' << ms::hog_floor_mb(in.cap_mb) << ' '
              << ms::should_notice_hog(active_mb, in.cap_mb, plan.over_mb);
    for (auto index : plan.victims) std::cout << ' ' << index;
    std::cout << '\n';
  }
  return std::cin.eof() ? 0 : 2;
}
