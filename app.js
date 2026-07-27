const API = 'https://api.openf1.org/v1';
const state = { sessions: [], session: null, drivers: new Map() };
let demoSpeed = 1;
const SIM_GRID = [
  ['NOR','McLaren','FF8700'],['PIA','McLaren','FF8700'],['RUS','Mercedes','27F4D2'],['ANT','Mercedes','27F4D2'],['VER','Red Bull Racing','3671C6'],['HAD','Red Bull Racing','3671C6'],['LEC','Ferrari','FF2443'],['HAM','Ferrari','FF2443'],['ALB','Williams','1868DB'],['SAI','Williams','1868DB'],['LAW','Racing Bulls','7192FF'],['LIN','Racing Bulls','7192FF'],['ALO','Aston Martin','229971'],['STR','Aston Martin','229971'],['OCO','Haas','B6BABD'],['BEA','Haas','B6BABD'],['HUL','Audi','F24B22'],['BOR','Audi','F24B22'],['GAS','Alpine','E878C8'],['COL','Alpine','E878C8'],['BOT','Cadillac','C6C6C6'],['PER','Cadillac','C6C6C6']
].map(([name, team, colour], index) => ({ driver_number:index + 1, name_acronym:name, team_name:team, team_colour:colour }));
const CAR_SPRITES = { McLaren:'mclaren', Mercedes:'mercedes', 'Red Bull Racing':'red-bull', Ferrari:'ferrari', Williams:'williams', 'Racing Bulls':'racing-bulls', 'Aston Martin':'aston-martin', Haas:'haas', Audi:'audi', Alpine:'alpine', Cadillac:'cadillac' };
let simulation = null;
let demoCars = [];
let demoRoute = null;
const $ = (id) => document.getElementById(id);
if (new URLSearchParams(location.search).has('full')) document.body.classList.add('full-mode');

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
    if (simulation) return;
    state.drivers = new Map(drivers.map(driver => [driver.driver_number, driver]));
    renderTower(positions, stints, intervals);
    renderRacePulse(positions, intervals, laps, overtakes);
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
  const weather = latestBy(items); if (!weather) { $('weather-summary').textContent = '—'; return; }
  const condition = weather.rainfall ? 'WET' : 'DRY';
  $('weather-summary').textContent = `${weather.track_temperature?.toFixed(0) ?? '—'}° · ${condition}`;
}
function renderRacePulse(positions, intervals, laps, overtakes) {
  const order = uniqueLatest(positions, 'driver_number').sort((a, b) => a.position - b.position);
  const intervalMap = new Map(uniqueLatest(intervals, 'driver_number').map(item => [item.driver_number, item]));
  const speedMap = new Map();
  for (const lap of laps) {
    const speed = Math.max(lap.st_speed || 0, lap.i1_speed || 0, lap.i2_speed || 0);
    if (speed > (speedMap.get(lap.driver_number) || 0)) speedMap.set(lap.driver_number, speed);
  }
  const passMap = new Map();
  for (const pass of overtakes) passMap.set(pass.overtaking_driver_number, (passMap.get(pass.overtaking_driver_number) || 0) + 1);
  const numericGaps = order.map(item => Number(intervalMap.get(item.driver_number)?.gap_to_leader)).filter(Number.isFinite);
  const largestGap = Math.max(...numericGaps, 1);
  if (!order.length) return empty('race-pulse');
  $('race-pulse').innerHTML = order.slice(0, 12).map((item) => {
    const driver = state.drivers.get(item.driver_number) || {};
    const interval = intervalMap.get(item.driver_number) || {};
    const gap = Number(interval.gap_to_leader);
    const percentage = item.position === 1 ? 100 : Number.isFinite(gap) ? Math.max(8, 100 - (gap / largestGap * 88)) : 8;
    const close = Number(interval.interval);
    const intervalLabel = item.position === 1 ? 'LEADER' : Number.isFinite(close) ? `+${close.toFixed(3)}` : '—';
    const gapLabel = item.position === 1 ? 'ON POINT' : Number.isFinite(gap) ? `+${gap.toFixed(3)}` : '—';
    const colour = `#${driver.team_colour || '65748a'}`;
    return `<div class="pulse-row">
      <div class="pulse-driver"><span class="team-mark" style="background:${colour}"></span><div><strong>P${item.position} ${escapeHtml(driver.name_acronym || `CAR ${item.driver_number}`)}</strong><small>${escapeHtml(driver.team_name || '')}</small></div></div>
      <div class="neon-track" title="${gapLabel} to leader"><div class="neon-bar" style="width:${percentage}%;background:${colour};color:${colour}"></div></div>
      <div class="pulse-value muted">${intervalLabel}</div>
      <div class="pulse-value">${speedMap.get(item.driver_number) ? `${speedMap.get(item.driver_number)} <small>KM/H</small>` : '—'}</div>
      <div class="pulse-value pass-count passes-column">+${passMap.get(item.driver_number) || 0}</div>
    </div>`;
  }).join('');
}
function driverName(number) { return state.drivers.get(number)?.name_acronym || `CAR ${number}`; }
function renderPit(items) { const stops = [...items].sort((a,b) => new Date(b.date)-new Date(a.date)).slice(0,5); $('pit-count').textContent=`${items.length} STOP${items.length===1?'':'S'}`; if (!stops.length) return empty('pit-stops'); $('pit-stops').innerHTML=stops.map(p=>`<div class="event"><span class="event-badge">L${p.lap_number ?? '—'}</span><strong>${driverName(p.driver_number)}</strong><small>${p.stop_duration ? `${p.stop_duration.toFixed(1)}s stop` : 'Pit lane'}<br>${time(p.date)}</small></div>`).join(''); }
function renderOvertakes(items) { const passes = [...items].sort((a,b) => new Date(b.date)-new Date(a.date)).slice(0,8); $('overtake-count').textContent=`${items.length} PASS${items.length===1?'':'ES'}`; if (!passes.length) return empty('overtakes'); $('overtakes').innerHTML=passes.map(o=>`<div class="event"><span class="event-badge">P${o.position}</span><strong>${driverName(o.overtaking_driver_number)}</strong><span>passed ${driverName(o.overtaken_driver_number)}</span><small>${time(o.date)}</small></div>`).join(''); }
function renderControl(items) { const messages = [...items].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,6); if (!messages.length) return empty('race-control'); $('race-control').innerHTML=messages.map(m=>`<div class="control"><span class="flag">${escapeHtml(m.flag || m.category || 'NOTICE')}</span><span>${escapeHtml(m.message || 'Race control update')}</span><time>${time(m.date)}</time></div>`).join(''); }
function renderLap(items) { const latest = latestBy(items, 'date_start'); $('race-lap').textContent = latest?.lap_number ? `LAP ${latest.lap_number}` : '—'; }

$('refresh-button').addEventListener('click', () => simulation ? startSimulator() : loadSession(state.session.session_key));
loadSessions().catch(error => { console.error(error); $('status-text').textContent='OFFLINE'; $('data-notice').textContent=`Could not connect to OpenF1: ${error.message}`; });
setInterval(() => { if (state.session && !simulation) loadSession(state.session.session_key); }, 30000);

function startDemoRace() {
  const route = $('race-route');
  if (!route) return;
  demoRoute = route;
  const carLayer = $('demo-cars');
  const cars = SIM_GRID.map((driver, index) => {
    const element = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    element.setAttribute('class', 'demo-car');
    const sprite = CAR_SPRITES[driver.team_name];
    element.innerHTML = `<image href="assets/cars/${sprite}-sprite.png" x="-24" y="-12" width="48" height="24" preserveAspectRatio="xMidYMid meet"/><text x="19" y="-10" fill="#${driver.team_colour}" style="font:700 8px Inter,sans-serif;paint-order:stroke;stroke:#080c13;stroke-width:2px">${driver.name_acronym}</text>`;
    carLayer.append(element);
    return { driver, element, distance: 190 - index * 10, totalDistance:190 - index * 10, pace:7.3 + Math.random() * .7, target:null, trackVelocity:0 };
  });
  demoCars = cars;
  const routeLength = route.getTotalLength();
  let lastTime = performance.now();
  let replayTime = 0;
  function frame(now) {
    const delta = Math.min((now - lastTime) / 1000, .08) * demoSpeed;
    lastTime = now;
    replayTime += delta;
    const phase = replayTime % 22;
    cars.forEach((car, index) => { car.pace = 27 + ((index * 7 + Math.floor(phase)) % 9) / 2; });
    if (!simulation) { cars[0].pace += phase > 8 && phase < 14 ? 8 : 0; cars[4].pace += phase < 8 ? 7 : 2; cars[6].pace += phase > 13 ? 9 : 0; }
    for (const car of cars) {
      const target = simulation?.track.get(car.driver.driver_number);
      if (target == null) car.distance = (car.distance + car.pace * delta) % 1000;
      else {
        if (car.target !== target) {
          let forwardDistance = (target - car.distance + 1000) % 1000;
          if (forwardDistance > 140) forwardDistance = 32;
          car.target = target;
          car.trackVelocity = Math.min(32, forwardDistance / (1.8 / demoSpeed));
        }
        car.distance = (car.distance + car.trackVelocity * delta + 1000) % 1000;
      }
      car.totalDistance += (target == null ? car.pace : car.trackVelocity) * delta;
      const point = route.getPointAtLength((car.distance / 1000) * routeLength);
      const ahead = route.getPointAtLength((((car.distance + 2) % 1000) / 1000) * routeLength);
      const angle = Math.atan2(ahead.y - point.y, ahead.x - point.x) * 180 / Math.PI;
      car.element.setAttribute('transform', `translate(${point.x} ${point.y}) rotate(${angle})`);
    }
    if (!simulation) { const lap = phase < 7 ? 13 : phase < 14 ? 15 : 16; $('demo-lap').textContent = `LAP ${lap} / 18`; }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
startDemoRace();
document.querySelectorAll('.speed-button').forEach((button) => {
  button.addEventListener('click', () => {
    demoSpeed = Number(button.dataset.speed);
    document.querySelectorAll('.speed-button').forEach((item) => item.classList.toggle('active', item === button));
  });
});

function startSimulator() {
  if (simulation) return;
  state.drivers = new Map(SIM_GRID.map(driver => [driver.driver_number, driver]));
  simulation = { lap: 1, order: [...demoCars].sort((a,b) => b.totalDistance - a.totalDistance).map(car => car.driver.driver_number), overtakes: [], pits: [], control: [], timer: null, track:new Map(SIM_GRID.map((driver,index) => [driver.driver_number, 210 - index * 13])) };
  $('simulator-button').classList.add('active');
  $('simulator-button').textContent = 'LIVE SIM';
  $('session-select').disabled = true;
  $('data-notice').textContent = 'Race Simulator mode — full 2026 grid. Switch it off to return to OpenF1 historical sessions.';
  $('status-text').textContent = 'SIMULATING';
  function tick() {
    const sim = simulation; if (!sim) return;
    sim.lap = sim.lap === 57 ? 1 : sim.lap + 1;
    const previousOrder = [...sim.order];
    sim.order = [...demoCars].sort((a,b) => b.totalDistance - a.totalDistance).map(car => car.driver.driver_number);
    const movedIndex = sim.order.findIndex((driver, index) => previousOrder.indexOf(driver) > index);
    const overtaker = movedIndex > 0 ? sim.order[movedIndex] : null;
    const overtaken = movedIndex > 0 ? previousOrder[movedIndex - 1] : null;
    if (overtaker) sim.overtakes.unshift({ date:new Date().toISOString(), overtaking_driver_number:overtaker, overtaken_driver_number:overtaken, position:movedIndex + 1 });
    if (Math.random() < .32) { const driver = sim.order[8 + Math.floor(Math.random() * 14)]; sim.pits.unshift({ date:new Date().toISOString(), driver_number:driver, lap_number:sim.lap, stop_duration:1.9 + Math.random() * .8 }); }
    if (overtaker) sim.control.unshift({ date:new Date().toISOString(), category:'Race Control', flag:'GREEN', message:`CAR ${state.drivers.get(overtaker).name_acronym} OVERTAKES ${state.drivers.get(overtaken).name_acronym} FOR P${movedIndex + 1}` });
    const positions = sim.order.map((driver_number, index) => ({ driver_number, position:index + 1, date:new Date().toISOString() }));
    positions.forEach((item, index) => sim.track.set(item.driver_number, (210 + sim.lap * 55 - index * 13 + 1000) % 1000));
    const intervals = positions.map((item, index) => ({ driver_number:item.driver_number, date:item.date, gap_to_leader:index ? +(index * 1.06 + Math.random() * .42).toFixed(3) : null, interval:index ? +(.35 + Math.random() * .85).toFixed(3) : null }));
    const laps = positions.map(item => ({ driver_number:item.driver_number, lap_number:sim.lap, date_start:item.date, st_speed:306 + Math.floor(Math.random() * 44) }));
    const stints = positions.map(item => ({ driver_number:item.driver_number, compound:['SOFT','MEDIUM','HARD'][Math.floor((sim.lap + item.position) / 9) % 3], tyre_age_at_start:Math.max(0, sim.lap - (sim.lap % 9)), lap_start:sim.lap - (sim.lap % 9), lap_end:sim.lap }));
    renderTower(positions, stints, intervals); renderRacePulse(positions, intervals, laps, sim.overtakes); renderPit(sim.pits); renderOvertakes(sim.overtakes); renderControl(sim.control); renderLap(laps);
    const passing = state.drivers.get(overtaker || sim.order[0]); const passed = state.drivers.get(overtaken);
    $('demo-lap').textContent = `LAP ${sim.lap} / 57`;
    $('demo-commentary').innerHTML = overtaker ? `<span><b style="background:#${passing.team_colour}"></b>${passing.name_acronym} passes ${passed.name_acronym} for P${movedIndex + 1}</span><span class="demo-speed">${passing.team_name.toUpperCase()} · ${306 + Math.floor(Math.random() * 44)} KM/H</span>` : `<span><b style="background:#${passing.team_colour}"></b>${passing.name_acronym} leads the race</span><span class="demo-speed">FIELD RUNNING NORMALLY</span>`;
    renderWeather([{ air_temperature:24.6, track_temperature:37.2, rainfall:0, wind_speed:2.8, date:new Date().toISOString() }]);
    $('last-update').textContent = time(new Date());
  }
  tick(); simulation.timer = setInterval(tick, 1800);
}
function stopSimulator() {
  if (!simulation) return;
  clearInterval(simulation.timer); simulation = null;
  $('simulator-button').classList.remove('active'); $('simulator-button').textContent = 'RACE SIM'; $('session-select').disabled = false;
  $('data-notice').textContent = 'Historical mode — showing the latest session available from OpenF1. Live data can be connected later.';
  loadSession(state.session.session_key);
}
$('simulator-button').addEventListener('click', () => simulation ? stopSimulator() : startSimulator());
setTimeout(startSimulator, 250);
