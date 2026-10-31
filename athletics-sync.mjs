#!/usr/bin/env node
/* Fetches the school's public athletics calendar and writes athletics.json.
   The planner cannot read the feed itself: the school's server sends no CORS
   header, so a browser refuses the response. This runs outside a browser, where
   that rule does not apply, and republishes the games from a site that allows it.

   A bad fetch never reaches students. Anything that fails exits non-zero before
   the output file is touched, so the last good copy simply stays up.

   usage: node athletics-sync.mjs <output.json> */
import { readFileSync, renameSync, writeFileSync } from 'node:fs';

const FEED = 'https://www.meadowbrook-ma.org/school-life/athletics/schedules?export=1';
const out = process.argv[2];
if (!out) { console.error('usage: athletics-sync.mjs <output.json>'); process.exit(2); }

function field(block, key) {
  const m = block.match(new RegExp('^' + key + '([^:\\n]*):(.*)$', 'm'));
  return m ? { params: m[1], value: m[2].trim() } : { params: '', value: '' };
}
function text(s) {
  return String(s)
    .replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim();
}
/* Times are written in school-local time and shown exactly as written, so a
   student in another timezone still reads the time on the school's clock. */
function when(prop) {
  const v = prop.value;
  const d = v.slice(0, 4) + '-' + v.slice(4, 6) + '-' + v.slice(6, 8);
  if (v.length < 15) return { date: d, time: null };
  if (v.endsWith('Z')) {
    const iso = d + 'T' + v.slice(9, 11) + ':' + v.slice(11, 13) + ':' + v.slice(13, 15) + 'Z';
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).formatToParts(new Date(iso)).map(x => [x.type, x.value]));
    return { date: p.year + '-' + p.month + '-' + p.day, time: p.hour + ':' + p.minute };
  }
  return { date: d, time: v.slice(9, 11) + ':' + v.slice(11, 13) };
}

/* The feed has no team field, only titles typed by hand, so the team comes out
   of the title. "Tennis Home vs Fessenden", "JV Girls Soccer Away @ Park",
   "5th Grade Girls Soccer @ Tenacre", "Cross Country - Home Meet". */
const FIX_TEAM = { 'JV Boys': 'JV Boys Soccer' };
function parseTitle(raw) {
  let title = raw, badge = null;
  const pre = title.match(/^(under the lights\s*[-–]\s*|friday night scoops\s+)(.*)$/i);
  if (pre) { badge = /lights/i.test(pre[1]) ? 'Under the Lights' : 'Friday Night Scoops'; title = pre[2]; }
  const meet = title.match(/^(.+?)\s*[-–]\s*home meet$/i);
  if (meet) return { team: meet[1], where: 'home', opponent: null, badge };
  const g = title.match(/^(.+?)\s+(?:(home|away)\s+)?(vs\.?|@)\s+(.+)$/i);
  if (!g) return { team: null, where: null, opponent: null, badge };
  const away = /away/i.test(g[2] || '') || g[3] === '@';
  return { team: FIX_TEAM[g[1]] || g[1], where: away ? 'away' : 'home', opponent: g[4], badge };
}
function pickup(desc) {
  const m = desc.match(/pick\s*-?\s*up\s*(?:at\s*)?(\d{1,2}(?::\d{2})?)/i);
  return m ? m[1] : null;
}

const res = await fetch(FEED, { headers: { 'User-Agent': 'MeadowbrookStudentPlanner/1.0' } });
if (!res.ok) { console.error('feed returned', res.status); process.exit(1); }
const body = await res.text();
if (!body.includes('BEGIN:VCALENDAR')) { console.error('feed is not a calendar'); process.exit(1); }

const unfolded = body.replace(/\r?\n[ \t]/g, '');
const blocks = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
const events = blocks.map(b => {
  const title = text(field(b, 'SUMMARY').value);
  const start = when(field(b, 'DTSTART'));
  const end = when(field(b, 'DTEND'));
  const desc = text(field(b, 'DESCRIPTION').value);
  const place = text(field(b, 'LOCATION').value);
  const t = parseTitle(title);
  const pick = pickup(desc);
  const e = { id: field(b, 'UID').value.replace(/@.*/, ''), date: start.date, time: start.time,
              end: end.time, title, team: t.team, where: t.where, opponent: t.opponent };
  if (t.badge) e.badge = t.badge;
  if (place) e.place = place;
  if (pick) e.pickup = pick;
  else if (desc && desc !== title && !t.team) e.note = desc.slice(0, 200);
  return e;
}).filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.title)
  .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));

if (!events.length) { console.error('feed parsed to nothing'); process.exit(1); }

let previous = null;
try { previous = JSON.parse(readFileSync(out, 'utf8')); } catch (e) {}
const same = previous && JSON.stringify(previous.events) === JSON.stringify(events);
const now = new Date().toISOString();
const payload = { checkedAt: now, changedAt: same ? previous.changedAt : now, source: FEED, events };

writeFileSync(out + '.tmp', JSON.stringify(payload));
renameSync(out + '.tmp', out);
console.log(events.length, 'events,', events.filter(e => !e.team).length, 'without a team,',
            same ? 'no changes' : 'CHANGED');
