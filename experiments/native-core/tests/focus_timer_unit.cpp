#include "dexerion/focus_timer.hpp"

#include <iostream>
#include <limits>
#include <stdexcept>

namespace ft = dexerion::focus_timer;

static void require(bool outcome, const char* message) {
  if (!outcome) throw std::logic_error(message);
}

int main() {
  try {
    ft::FocusTimer t(38, 8);
    require(t.state().remaining_ms == 25 * 60000 && t.state().work_min == 38, "initial stored settings");
    t.configure_duration(181, std::numeric_limits<double>::quiet_NaN());
    require(t.state().work_min == 180 && t.state().break_min == 8, "valid caps and fallbacks");
    auto e = t.start(ft::Phase::work, 10000, 1999);
    require(e.timer == ft::TimerEffect::replace && t.state().ends_at_ms == 11999, "start");
    require(t.state().remaining_ms == 2000 && t.state().blocking, "display rounds up");
    e = t.tick(10999);
    require(e.change == ft::Change::tick && t.state().remaining_ms == 1000, "tick is not a transition");
    t.pause(11998);
    require(!t.state().running && t.state().blocking && t.state().ends_at_ms == 0, "paused work still blocks");
    require(t.tick(12500).change == ft::Change::none, "paused clock does not expire");
    t.toggle(15000);
    require(t.state().ends_at_ms == 16000, "minimum resume duration");
    e = t.tick(16000);
    require(e.notice == ft::Notice::work_done && e.timer == ft::TimerEffect::cancel, "one completion notice");
    require(t.state().phase == ft::Phase::rest && !t.state().running && !t.state().blocking, "paused break");
    require(t.tick(17000).notice == ft::Notice::none, "no duplicate completion");
    t.start(ft::Phase::rest, 18000, 1000); e = t.tick(19000);
    require(e.notice == ft::Notice::break_over && t.state().blocking && !t.state().running, "break end");
    t.skip(); require(t.state().phase == ft::Phase::rest, "skip"); t.reset();
    require(t.state().phase == ft::Phase::idle && !t.state().blocking, "reset");
    std::cout << "PASS native Focus Timer contracts\n";
  } catch (const std::exception& e) {
    std::cerr << "FAIL: " << e.what() << '\n'; return 1;
  }
  return 0;
}
