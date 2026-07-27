const API = 'https://api.openf1.org/v1';
const state = { sessions: [], session: null, drivers: new Map() };
const $ = (id) => document.getElementById(id);

async function get(endpoint) {
  const response = await fetch(`${API}/${endpoint}`);
  if (!response.ok) throw new Error(`OpenF1 responded with ${response.status}`);
  return response.json();
}

function latestBy(items, key = 'date') {
  return [...items].sort((a, b) => new Date(b[key] || 0) - new Date(a[key] || 0))[0];
}
function uniqueLatest(items, field) {
  const results = new Map();
  for (const item of items) if (!results.has(item[field]) || new Date(item.date) > new Date(results.get(item[field]).date)) results.set(item[field], item);
  return [...results.values()];
}
function empty(id) { $(id).replaceChildren($('empty-state').content.cloneNode(true)); }
function escapeHtml(value = '') { const box = document.createElement('span'); box.textContent = value; return box.innerHTML; }
function time(date) { return date ? new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit'}).format(new Date(date)) : '—'; }
function tyreColor(compound) { return ({ SOFT:'#ee324b', MEDIUM:'#ffd34e', HARD:'#edf0f2', INTERMEDIATE:'#44b978', WET:'#478bdb' })[compound] || '#59677b'; }

async function loadSessions() {
  const sessions = await get('sessions?year=2026');
  state.sessions = sessions.sort((a,b) => new Date(b.date_start) - new Date(a.date_start));
  const select = $('session-select');
  select.innerHTML = state.sessions.map(s => `<option value="${s.session_key}">${escapeHtml(s.country_name)} · ${escapeHtml(s.session_name)} · ${new Date(s.date_start).toLocaleDateString()}</option>`).join('');
  select.addEventListener('change', () => loadSession(Number(select.value)));
  if (!state.sessions.length) throw new Error('No sessions were returned.');
  await loadSession(state.sessions[0].session_key);
}

async function loadSession(sessionKey) {
  state.session = state.sessions.find(s => s.session_key === sessionKey);
  $('session-select').value = String(sessionKey);
  $('meeting-name').textContent = state.session.meeting_name || state.session.country_name;
  $('session-name').textContent = state.session.session_name?.toUpperCase() || 'SESSION';
  $('meeting-location').textContent = `${state.session.location || ''} · ${state.session.country_name || ''}`;
  $('status-text').textContent = 'LOADING';
  document.querySelector('.status-dot').style.background = '#ffd052';
  try {
    const [drivers, positions, stints, intervals, laps, weather, pit, overtakes, control] = await Promise.all([
      get(`drivers?session_key=${sessionKey}`), get(`position?session_key=${sessionKey}`), get(`stints?session_key=${sessionKey}`), get(`intervals?session_key=${sessionKey}`), get(`laps?session_key=${sessionKey}`), get(`weather?session_key=${sessionKey}`), get(`pit?session_key=${sessionKey}`), get(`overtakes?session_key=${sessionKey}`), get(`race_control?session_key=${sessionKey}`)
    ]);
    state.drivers = new Map(drivers.map(driver => [driver.driver_number, driver]));
    renderTower(positions, stints, intervals);
    renderWeather(weather); renderPit(pit); renderOvertakes(overtakes); renderControl(control); renderLap(laps);
    $('status-text').textContent = 'CONNECTED';
    document.querySelector('.status-dot').style.background = '#3ee68b';
    $('last-update').textContent = time(new Date());
  } catch (error) {
    console.error(error);
    $('status-text').textContent = 'RETRY NEEDED';
    $('data-notice').textContent = `Could not load OpenF1 data: ${error.message}. Check your internet connection, then refresh.`;
    document.querySelector('.status-dot').style.background = '#ff2443';
  }
}

function renderTower(positions, stints, intervals) {
  const positionList = uniqueLatest(positions, 'driver_number').sort((a,b) => a.position - b.position);
  const stintMap = new Map(uniqueLatest(stints, 'driver_number').map(s => [s.driver_number, s]));
  const intervalMap = new Map(uniqueLatest(intervals, 'driver_number').map(i => [i.driver_number, i]));
  const tower = $('timing-tower');
  if (!positionList.length) return empty('timing-tower');
  tower.innerHTML = positionList.map((item) => {
    const driver = state.drivers.get(item.driver_number) || {};
    const stint = stintMap.get(item.driver_number) || {};
    const interval = intervalMap.get(item.driver_number) || {};
    const gap = item.position === 1 ? 'LEADER' : interval.gap_to_leader != null ? `+${Number(interval.gap_to_leader).toFixed(3)}` : '—';
    const tyreAge = stint.tyre_age_at_start != null && stint.lap_start != null ? stint.tyre_age_at_start + Math.max(0, (stint.lap_end || stint.lap_start) - stint.lap_start) : '—';
    return `<article class="timing-row ${item.position === 1 ? 'leader' : ''}">
      <div class="position">${item.position}</div><div class="driver"><span class="team-mark" style="background:#${driver.team_colour || '65748a'}"></span><div><div class="driver-name">${escapeHtml(driver.name_acronym || `CAR ${item.driver_number}`)}</div><div class="team-name">${escapeHtml(driver.team_name || '')}</div></div></div>
      <div class="tyre"><span class="tyre-dot" style="background:${tyreColor(stint.compound)}"></span><span>${stint.compound ? stint.compound.slice(0,3) : '—'} ${tyreAge}</span></div><div class="gap">${gap}</div></article>`;
  }).join('');
}
function renderWeather(items) {
  const weather = latestBy(items); if (!weather) return empty('weather-grid');
  const values = [['AIR',`${weather.air_temperature?.toFixed(1) ?? '—'}°C`],['TRACK',`${weather.track_temperature?.toFixed(1) ?? '—'}°C`],['RAIN',weather.rainfall ? 'YES' : 'NO'],['WIND',`${weather.wind_speed?.toFixed(1) ?? '—'} km/h`]];
  $('weather-grid').innerHTML = values.map(([label,value]) => `<div class="weather-item"><span>${label}</span><strong>${value}</strong></div>`).join('');
}
function driverName(number) { return state.drivers.get(number)?.name_acronym || `CAR ${number}`; }
function renderPit(items) { const stops = [...items].sort((a,b) => new Date(b.date)-new Date(a.date)).slice(0,5); $('pit-count').textContent=`${items.length} STOP${items.length===1?'':'S'}`; if (!stops.length) return empty('pit-stops'); $('pit-stops').innerHTML=stops.map(p=>`<div class="event"><span class="event-badge">L${p.lap_number ?? '—'}</span><strong>${driverName(p.driver_number)}</strong><small>${p.stop_duration ? `${p.stop_duration.toFixed(1)}s stop` : 'Pit lane'}<br>${time(p.date)}</small></div>`).join(''); }
function renderOvertakes(items) { const passes = [...items].sort((a,b) => new Date(b.date)-new Date(a.date)).slice(0,8); $('overtake-count').textContent=`${items.length} PASS${items.length===1?'':'ES'}`; if (!passes.length) return empty('overtakes'); $('overtakes').innerHTML=passes.map(o=>`<div class="event"><span class="event-badge">P${o.position}</span><strong>${driverName(o.overtaking_driver_number)}</strong><span>passed ${driverName(o.overtaken_driver_number)}</span><small>${time(o.date)}</small></div>`).join(''); }
function renderControl(items) { const messages = [...items].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,6); if (!messages.length) return empty('race-control'); $('race-control').innerHTML=messages.map(m=>`<div class="control"><span class="flag">${escapeHtml(m.flag || m.category || 'NOTICE')}</span><span>${escapeHtml(m.message || 'Race control update')}</span><time>${time(m.date)}</time></div>`).join(''); }
function renderLap(items) { const latest = latestBy(items, 'date_start'); $('race-lap').textContent = latest?.lap_number ? `LAP ${latest.lap_number}` : '—'; }

$('refresh-button').addEventListener('click', () => loadSession(state.session.session_key));
loadSessions().catch(error => { console.error(error); $('status-text').textContent='OFFLINE'; $('data-notice').textContent=`Could not connect to OpenF1: ${error.message}`; });
