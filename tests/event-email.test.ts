import assert from "node:assert/strict";
import test from "node:test";
import { eventStartLabel, reminderTimes } from "../server/email/event-policy";
import { renderEmailTemplate } from "../server/email/templates";

test("event calendar dates and 8am reminders are safe across New York DST changes", () => {
  assert.equal(reminderTimes(new Date("2027-03-13T00:00:00Z")).day_of.toISOString(), "2027-03-13T13:00:00.000Z");
  assert.equal(reminderTimes(new Date("2027-03-13T00:00:00Z")).day_after.toISOString(), "2027-03-14T12:00:00.000Z");
  assert.equal(reminderTimes(new Date("2027-11-06T00:00:00Z")).day_after.toISOString(), "2027-11-07T13:00:00.000Z");
  assert.match(eventStartLabel(new Date("2027-03-14"), "14:30"), /Mar 14, 2027 at 2:30 PM EDT/);
  assert.match(eventStartLabel(new Date("2027-01-14"), "2:30 PM"), /2:30 PM EST/);
  assert.match(eventStartLabel(new Date("2027-01-14"), null), /not specified/);
  assert.throws(() => eventStartLabel(new Date("2027-03-14"), "02:30"));
  assert.throws(() => eventStartLabel(new Date("2027-03-14"), "25:30"));
});

test("event follow-up and reviewer templates describe the correct audience without review contents", () => {
  const reminder = renderEmailTemplate("event_reminder", {
    firstName: "<Coach>", eventName: "<Final>", eventStart: "Tomorrow",
    venue: "Gym", assignedOfficials: ["Official"], reminderKind: "day_after",
  });
  assert.match(reminder.subject, /evaluation reminder/);
  assert.match(reminder.text, /not yet submitted an evaluation/);
  assert.match(reminder.html, /&lt;Coach&gt;/);
  const reviewer = renderEmailTemplate("evaluation_submitted", {
    firstName: "Supervisor", eventName: "Final", officialName: "Official",
    isPending: false, audience: "reviewer", coachName: "<Coach>",
  });
  assert.match(reviewer.text, /<Coach> submitted an evaluation/);
  assert.match(reviewer.html, /&lt;Coach&gt;/);
  assert.doesNotMatch(reviewer.text, /Thank you for submitting/);
});
