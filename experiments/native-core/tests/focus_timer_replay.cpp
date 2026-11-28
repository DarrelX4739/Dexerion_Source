#include "dexerion/focus_timer.hpp"

#include <cmath>
#include <iomanip>
#include <iostream>
#include <optional>
#include <string>

namespace ft = dexerion::focus_timer;

int main() {
  ft::FocusTimer timer;
  std::string op;
  std::cout << std::setprecision(17);
  while (std::cin >> op) {
    double now = 0, a = 0, b = 0;
    int present = 0;
    if (!(std::cin >> now >> present >> a >> b) || !std::isfinite(now) ||
        !std::isfinite(a) || !std::isfinite(b) || present < 0 || present > 3) return 2;
    ft::Effects e;
    if (op == "new") timer = ft::FocusTimer(present & 1 ? a : 25, present & 2 ? b : 5);
    else if (op == "work") e = timer.start(ft::Phase::work, now, a);
    else if (op == "break") e = timer.start(ft::Phase::rest, now, a);
    else if (op == "configure") {
      e = timer.configure_duration(present & 1 ? std::optional<double>(a) : std::nullopt,
                                   present & 2 ? std::optional<double>(b) : std::nullopt);
    } else if (op == "toggle") e = timer.toggle(now);
    else if (op == "pause") e = timer.pause(now);
    else if (op == "skip") e = timer.skip();
    else if (op == "reset") e = timer.reset();
    else if (op == "tick") e = timer.tick(now);
    else if (op != "state") return 2;
    const auto s = timer.state();
    std::cout << ft::name(s.phase) << ' ' << s.running << ' ' << s.remaining_ms << ' '
              << s.ends_at_ms << ' ' << s.work_min << ' ' << s.break_min << ' '
              << s.blocking << ' ' << static_cast<int>(e.change) << ' ' << static_cast<int>(e.notice)
              << ' ' << static_cast<int>(e.timer) << '\n';
  }
  return std::cin.eof() ? 0 : 2;
}
