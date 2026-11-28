#include "dexerion/focus_timer.hpp"

#include <algorithm>
#include <cmath>

namespace dexerion::focus_timer {

std::string_view name(Phase phase) noexcept {
  switch (phase) {
    case Phase::idle: return "idle";
    case Phase::work: return "work";
    case Phase::rest: return "break";
  }
  return {};
}

FocusTimer::FocusTimer(double work_min, double break_min) noexcept {
  // JS initializes the idle display to 25m before reading profile config.
  // Its public work/break settings still reflect a previously saved duration.
  if (std::isfinite(work_min))
    work_min_ = static_cast<int>(std::clamp(std::floor(work_min), 1.0, 180.0));
  if (std::isfinite(break_min))
    break_min_ = static_cast<int>(std::clamp(std::floor(break_min), 1.0, 60.0));
}

Snapshot FocusTimer::state() const noexcept {
  return {phase_, running_, std::max(0.0, std::ceil(remaining_ms_ / 1000) * 1000),
          running_ ? ends_at_ms_ : 0.0, work_min_, break_min_, phase_ == Phase::work};
}

Effects FocusTimer::configure_duration(std::optional<double> work_min,
                                       std::optional<double> break_min) noexcept {
  if (work_min && std::isfinite(*work_min))
    work_min_ = static_cast<int>(std::clamp(std::floor(*work_min), 1.0, 180.0));
  if (break_min && std::isfinite(*break_min))
    break_min_ = static_cast<int>(std::clamp(std::floor(*break_min), 1.0, 60.0));
  if (phase_ == Phase::idle) remaining_ms_ = duration(Phase::work);
  return {Change::event, Notice::none, TimerEffect::none};
}

double FocusTimer::duration(Phase phase, double override_ms) const noexcept {
  if (override_ms > 0) return std::max(1000.0, std::floor(override_ms));
  return (phase == Phase::rest ? break_min_ : work_min_) * 60000.0;
}

Effects FocusTimer::start(Phase phase, double now_ms, double override_ms) noexcept {
  phase_ = phase == Phase::rest ? Phase::rest : Phase::work;
  remaining_ms_ = duration(phase_, override_ms);
  ends_at_ms_ = now_ms + remaining_ms_;
  running_ = true;
  return {Change::event, Notice::none, TimerEffect::replace};
}

Effects FocusTimer::toggle(double now_ms) noexcept {
  if (running_) return pause(now_ms);
  if (phase_ == Phase::idle) return start(Phase::work, now_ms);
  running_ = true;
  // The public remaining display retains its last value until tick(). A late
  // pause can therefore show zero briefly while resuming a 1s minimum timer.
  ends_at_ms_ = now_ms + std::max(1000.0, remaining_ms_);
  return {Change::event, Notice::none, TimerEffect::replace};
}

Effects FocusTimer::pause(double now_ms) noexcept {
  if (!running_) return {};
  remaining_ms_ = std::max(0.0, ends_at_ms_ - now_ms);
  running_ = false;
  ends_at_ms_ = 0;
  return {Change::event, Notice::none, TimerEffect::cancel};
}

void FocusTimer::advance_phase() noexcept {
  if (phase_ == Phase::idle) return;
  phase_ = phase_ == Phase::work ? Phase::rest : Phase::work;
  remaining_ms_ = duration(phase_);
}

Effects FocusTimer::skip() noexcept {
  auto timer = running_ ? TimerEffect::cancel : TimerEffect::none;
  running_ = false;
  ends_at_ms_ = 0;
  advance_phase();
  return {Change::event, Notice::none, timer};
}

Effects FocusTimer::reset() noexcept {
  auto timer = running_ ? TimerEffect::cancel : TimerEffect::none;
  phase_ = Phase::idle;
  running_ = false;
  ends_at_ms_ = 0;
  remaining_ms_ = duration(Phase::work);
  return {Change::event, Notice::none, timer};
}

Effects FocusTimer::tick(double now_ms) noexcept {
  if (!running_) return {};
  remaining_ms_ = ends_at_ms_ - now_ms;
  if (remaining_ms_ > 0) return {Change::tick, Notice::none, TimerEffect::none};
  const auto notice = phase_ == Phase::work ? Notice::work_done : Notice::break_over;
  running_ = false;
  ends_at_ms_ = 0;
  advance_phase();  // a completed interval does not auto-start its successor
  return {Change::event, notice, TimerEffect::cancel};
}

}  // namespace dexerion::focus_timer
