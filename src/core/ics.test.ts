import { describe, expect, it } from "vitest";
import { expand, findJoinUrl, parseIcs, parseProp, parseRRule, recur, unescapeText } from "./ics";

const cal = (...events: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", "X-WR-CALNAME:Work", ...events, "END:VCALENDAR"].join("\r\n");
const ev = (...lines: string[]) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");
const utc = (s: string) => Date.parse(s);
const local = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();
const range = (a: string, b: string) => [utc(a), utc(b)] as const;

/** Outlook-style zone: Windows name with its own VTIMEZONE rules (US Eastern) */
const EASTERN = [
  "BEGIN:VTIMEZONE",
  "TZID:Custom Eastern",
  "BEGIN:STANDARD",
  "DTSTART:16010101T020000",
  "TZOFFSETFROM:-0400",
  "TZOFFSETTO:-0500",
  "RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=1SU;BYMONTH=11",
  "END:STANDARD",
  "BEGIN:DAYLIGHT",
  "DTSTART:16010101T020000",
  "TZOFFSETFROM:-0500",
  "TZOFFSETTO:-0400",
  "RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=2SU;BYMONTH=3",
  "END:DAYLIGHT",
  "END:VTIMEZONE",
].join("\r\n");

describe("ics lines", () => {
  it("parses params, quoted values and escapes", () => {
    const p = parseProp('ATTENDEE;CN="Lee, Jordan";ROLE=REQ-PARTICIPANT:mailto:jl@x.com')!;
    expect(p.name).toBe("ATTENDEE");
    expect(p.params.CN).toBe("Lee, Jordan");
    expect(p.value).toBe("mailto:jl@x.com");
    expect(unescapeText("a\\, b\\; c\\nd\\\\e")).toBe("a, b; c\nd\\e");
  });

  it("unfolds long lines and reads the calendar name", () => {
    const c = parseIcs(cal(ev("UID:1", "DTSTART:20261023T140000Z", "DTEND:20261023T150000Z", "SUMMARY:Design re", " view")));
    expect(c.name).toBe("Work");
    expect(c.events[0].title).toBe("Design review");
  });
});

describe("ics times", () => {
  it("UTC and IANA zones", () => {
    const c = parseIcs(
      cal(
        ev("UID:a", "DTSTART:20261023T140000Z", "DTEND:20261023T150000Z", "SUMMARY:A"),
        ev("UID:b", "DTSTART;TZID=America/New_York:20261023T100000", "DTEND;TZID=America/New_York:20261023T103000", "SUMMARY:B"),
        ev("UID:c", "DTSTART;TZID=America/New_York:20261210T100000", "DURATION:PT45M", "SUMMARY:C"),
      ),
    );
    const [a, b] = expand(c, ...range("2026-10-23T00:00Z", "2026-10-24T00:00Z"));
    expect(a.start).toBe(utc("2026-10-23T14:00Z"));
    expect(b.start).toBe(utc("2026-10-23T14:00Z")); // EDT, UTC-4
    expect(b.end - b.start).toBe(30 * 60_000);
    const [cc] = expand(c, ...range("2026-12-10T00:00Z", "2026-12-11T00:00Z"));
    expect(cc.start).toBe(utc("2026-12-10T15:00Z")); // EST, UTC-5
    expect(cc.end - cc.start).toBe(45 * 60_000);
  });

  it("falls back to the VTIMEZONE rules for non-IANA names", () => {
    const c = parseIcs(
      cal(
        EASTERN,
        ev("UID:s", "DTSTART;TZID=Custom Eastern:20260715T090000", "DTEND;TZID=Custom Eastern:20260715T100000", "SUMMARY:Summer"),
        ev("UID:w", "DTSTART;TZID=Custom Eastern:20260115T090000", "DTEND;TZID=Custom Eastern:20260115T100000", "SUMMARY:Winter"),
      ),
    );
    expect(expand(c, ...range("2026-07-15T00:00Z", "2026-07-16T00:00Z"))[0].start).toBe(utc("2026-07-15T13:00Z"));
    expect(expand(c, ...range("2026-01-15T00:00Z", "2026-01-16T00:00Z"))[0].start).toBe(utc("2026-01-15T14:00Z"));
  });

  it("maps Windows zone names when the VTIMEZONE is missing", () => {
    const c = parseIcs(cal(ev("UID:p", 'DTSTART;TZID="Pacific Standard Time":20261023T090000', "DTEND;TZID=\"Pacific Standard Time\":20261023T093000", "SUMMARY:P")));
    expect(expand(c, ...range("2026-10-23T00:00Z", "2026-10-24T00:00Z"))[0].start).toBe(utc("2026-10-23T16:00Z"));
  });

  it("all-day events span local days, DTEND exclusive", () => {
    const c = parseIcs(cal(ev("UID:h", "DTSTART;VALUE=DATE:20261026", "DTEND;VALUE=DATE:20261028", "SUMMARY:Offsite")));
    const [e] = expand(c, local(2026, 10, 27), local(2026, 10, 28));
    expect(e.allDay).toBe(true);
    expect(e.start).toBe(local(2026, 10, 26));
    expect(e.end).toBe(local(2026, 10, 28));
    expect(expand(c, local(2026, 10, 28), local(2026, 10, 29))).toEqual([]);
  });
});

describe("ics recurrence", () => {
  const walls = (start: string, rule: string, until = "2027-12-31T00:00Z") =>
    [...recur(utc(start), parseRRule(rule)!, utc(until), () => true)].map((w) => new Date(w).toISOString().slice(0, 10));

  it("weekly on several days, with interval and count", () => {
    expect(walls("2026-10-05T09:00Z", "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=5")).toEqual(["2026-10-05", "2026-10-07", "2026-10-12", "2026-10-14", "2026-10-19"]);
    expect(walls("2026-10-05T09:00Z", "FREQ=WEEKLY;INTERVAL=2;COUNT=3")).toEqual(["2026-10-05", "2026-10-19", "2026-11-02"]);
  });

  it("monthly by nth weekday, last weekday and month day", () => {
    expect(walls("2026-10-13T09:00Z", "FREQ=MONTHLY;BYDAY=2TU;COUNT=3")).toEqual(["2026-10-13", "2026-11-10", "2026-12-08"]);
    expect(walls("2026-10-30T09:00Z", "FREQ=MONTHLY;BYDAY=-1FR;COUNT=3")).toEqual(["2026-10-30", "2026-11-27", "2026-12-25"]);
    expect(walls("2026-10-31T09:00Z", "FREQ=MONTHLY;BYMONTHDAY=31;COUNT=3")).toEqual(["2026-10-31", "2026-12-31", "2027-01-31"]);
    // Outlook's "last weekday of the month"
    expect(walls("2026-10-30T09:00Z", "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=3")).toEqual(["2026-10-30", "2026-11-30", "2026-12-31"]);
  });

  it("daily and yearly", () => {
    expect(walls("2026-10-30T09:00Z", "FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;COUNT=3")).toEqual(["2026-10-30", "2026-11-02", "2026-11-03"]);
    expect(walls("2026-03-15T09:00Z", "FREQ=YEARLY;COUNT=2")).toEqual(["2026-03-15", "2027-03-15"]);
  });

  it("keeps local time across DST, honours UNTIL, EXDATE and moved/cancelled instances", () => {
    const c = parseIcs(
      cal(
        ev(
          "UID:standup",
          "DTSTART;TZID=America/New_York:20261026T093000",
          "DTEND;TZID=America/New_York:20261026T094500",
          "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261124T000000Z",
          "EXDATE;TZID=America/New_York:20261109T093000",
          "SUMMARY:Standup",
        ),
        ev("UID:standup", "RECURRENCE-ID;TZID=America/New_York:20261102T093000", "DTSTART;TZID=America/New_York:20261103T110000", "DTEND;TZID=America/New_York:20261103T111500", "SUMMARY:Standup (moved)"),
        ev("UID:standup", "RECURRENCE-ID;TZID=America/New_York:20261116T093000", "DTSTART;TZID=America/New_York:20261116T093000", "STATUS:CANCELLED", "SUMMARY:Standup"),
      ),
    );
    const all = expand(c, ...range("2026-10-01T00:00Z", "2026-12-31T00:00Z"));
    expect(all.map((e) => [new Date(e.start).toISOString(), e.title])).toEqual([
      ["2026-10-26T13:30:00.000Z", "Standup"], // EDT
      ["2026-11-03T16:00:00.000Z", "Standup (moved)"], // EST, moved to Tuesday 11:00
      ["2026-11-23T14:30:00.000Z", "Standup"], // EST; the 9th is excluded, the 16th cancelled, UNTIL stops after the 23rd
    ]);
  });

  it("all-day recurring with date EXDATE", () => {
    const c = parseIcs(cal(ev("UID:pay", "DTSTART;VALUE=DATE:20261001", "RRULE:FREQ=MONTHLY;COUNT=4", "EXDATE;VALUE=DATE:20261101", "SUMMARY:Payday")));
    const got = expand(c, local(2026, 9, 1), local(2027, 3, 1)).map((e) => e.start);
    expect(got).toEqual([local(2026, 10, 1), local(2026, 12, 1), local(2027, 1, 1)]);
  });
});

describe("ics details", () => {
  it("finds meeting links, attendees and free/tentative", () => {
    const c = parseIcs(
      cal(
        ev(
          "UID:t",
          "DTSTART:20261023T140000Z",
          "DTEND:20261023T150000Z",
          "SUMMARY:Sync",
          "DESCRIPTION:Join here\\n<https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=x>\\nMore",
          'ATTENDEE;CN="Lee, Jordan":mailto:jl@x.com',
          "ATTENDEE:mailto:sam@x.com",
          "ORGANIZER;CN=Pat:mailto:pat@x.com",
          "X-MICROSOFT-CDO-BUSYSTATUS:TENTATIVE",
        ),
        ev("UID:f", "DTSTART:20261023T160000Z", "DTEND:20261023T170000Z", "SUMMARY:Focus", "TRANSP:TRANSPARENT"),
      ),
    );
    const [t, f] = expand(c, ...range("2026-10-23T00:00Z", "2026-10-24T00:00Z"));
    expect(t.joinUrl).toBe("https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=x");
    expect(t.attendees).toEqual(["Lee, Jordan", "sam@x.com"]);
    expect(t.organizer).toBe("Pat");
    expect(t.tentative).toBe(true);
    expect(f.free).toBe(true);
    expect(findJoinUrl("Join with Google Meet: https://meet.google.com/abc-defg-hij\n")).toBe("https://meet.google.com/abc-defg-hij");
    expect(findJoinUrl("https://acme.zoom.us/j/123456?pwd=x")).toBe("https://acme.zoom.us/j/123456?pwd=x");
  });
});
