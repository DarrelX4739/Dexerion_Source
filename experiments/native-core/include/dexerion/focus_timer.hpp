#pragma once

#include <optional>
#include <string_view>

namespace dexerion::focus_timer {

enum class Phase { idle, work, rest };
enum class Change { none, event, tick };
enum class Notice { none, work_done, break_over };
// replace means cancel the old timer (if present), then start a 500 ms tick.
enum class TimerEffect { none, cancel, replace };
struct Effects {
  Change change{Change::none};
  Notice notice{Notice::none};
  TimerEffect timer{TimerEffect::none};
};
struct Snapshot {
  Phase phase;
  bool running;
  double remaining_ms, ends_at_ms;
  int work_min, break_min;
  bool blocking;
};

std::string_view name(Phase phase) noexcept;

// A clock-free state machine, using the same finite millisecond timestamps as
// JS Date.now(). Read state() synchronously; it does not advance the clock.
// Profile/network enforcement and the timer/notification backends are outside.
class FocusTimer {
 public:
  explicit FocusTimer(double work_min = 25, double break_min = 5) noexcept;
  Snapshot state() const noexcept;
  Effects configure_duration(std::optional<double> work_min, std::optional<double> break_min) noexcept;
  Effects start(Phase phase, double now_ms, double override_ms = 0) noexcept;
  Effects toggle(double now_ms) noexcept;
  Effects pause(double now_ms) noexcept;
  Effects skip() noexcept;
  Effects reset() noexcept;
  Effects tick(double now_ms) noexcept;

 private:
  double duration(Phase phase, double override_ms = 0) const noexcept;
  void advance_phase() noexcept;

  Phase phase_{Phase::idle};
  bool running_{};
  int work_min_{25}, break_min_{5};
  double remaining_ms_{25 * 60000}, ends_at_ms_{};
};

}  // namespace dexerion::focus_timer
