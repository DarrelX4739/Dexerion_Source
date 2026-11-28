#include "dexerion/task_reminders.hpp"
#include "dexerion/js_number.hpp"

#include <iostream>
#include <cmath>
#include <limits>
#include <stdexcept>

namespace tr = dexerion::task_reminders;

static void require(bool outcome, const char* message) {
  if (!outcome) throw std::logic_error(message);
}

int main() {
  try {
    using dexerion::detail::js_round;
    require(js_round(std::nextafter(0.5, 0.0)) == 0 && js_round(0.5) == 1, "binary64 half edge");
    require(std::signbit(js_round(-0.5)) && js_round(std::nextafter(-0.5, -1.0)) == -1, "negative half");
    require(js_round(4503599627370497.0) == 4503599627370497.0, "already integral binary64");
    constexpr double now = 10'000'000;
    tr::Task t{u"keep", now + tr::kPreNotifyMs, 1};
    require(tr::reminder_kind(t, now-1) == tr::Reminder::none &&
            tr::reminder_kind(t, now) == tr::Reminder::pre, "pre-window edge");
    require(tr::reminder_kind(t, t.due_ms) == tr::Reminder::due, "due wins at boundary");
    require(!tr::next_reminder_at(t, std::numeric_limits<double>::quiet_NaN()), "invalid time");
    t.reminded_pre = true;
    require(tr::next_reminder_at(t, now) == t.due_ms, "remaining due");
    t.reminded_due = true;
    require(!tr::next_reminder_at(t, now), "finished reminders");
    t.done = true;
    auto u = t; u.done = false; u.reminded_due = false; u.reminded_pre = false;
    std::vector<tr::Task> rows{t,u};
    require(tr::next_three(rows).empty(), "deduplicate before filtering completed rows");
    u.id = u"s"; rows.push_back(u);
    require(tr::next_three(rows) == std::vector<std::size_t>{2}, "peek is open-only");
    require(tr::sort_tasks(rows) == std::vector<std::size_t>({2,0}), "sort uses first duplicates");
    require(tr::heartbeat_ms(rows, now, {30000,300000,600000}) == 30000, "near reminder");
    require(tr::heartbeat_ms({}, now, {30000,300000,600000}) == 300000, "idle cadence");
    require(tr::heartbeat_ms({}, now, {30000,300000,0}) == 30000, "legacy cadence");
    require(tr::heartbeat_ms(rows, now, {}) == 300000, "absent near-window matches JS");
    std::cout << "PASS native Tasks contracts\n";
  } catch (const std::exception& e) {
    std::cerr << "FAIL: " << e.what() << '\n'; return 1;
  }
  return 0;
}
