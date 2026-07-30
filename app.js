const API = 'https://api.openf1.org/v1';
const state = { sessions: [], session: null, drivers: new Map(), sessionData: null, selectedDriver: null };
let demoSpeed = 1;
const SIM_GRID = [
  ['NOR','McLaren','FF8700'],['PIA','McLaren','FF8700'],['RUS','Mercedes','27F4D2'],['ANT','Mercedes','27F4D2'],['VER','Red Bull Racing','3671C6'],['HAD','Red Bull Racing','3671C6'],['LEC','Ferrari','FF2443'],['HAM','Ferrari','FF2443'],['ALB','Williams','1868DB'],['SAI','Williams','1868DB'],['LAW','Racing Bulls','7192FF'],['LIN','Racing Bulls','7192FF'],['ALO','Aston Martin','229971'],['STR','Aston Martin','229971'],['OCO','Haas','B6BABD'],['BEA','Haas','B6BABD'],['HUL','Audi','F24B22'],['BOR','Audi','F24B22'],['GAS','Alpine','E878C8'],['COL','Alpine','E878C8'],['BOT','Cadillac','C6C6C6'],['PER','Cadillac','C6C6C6']
].map(([name, team, colour], index) => ({ driver_number:index + 1, name_acronym:name, team_name:team, team_colour:colour }));
const CAR_SPRITES = { McLaren:'mclaren', Mercedes:'mercedes', 'Red Bull Racing':'red-bull', Ferrari:'ferrari', Williams:'williams', 'Racing Bulls':'racing-bulls', 'Aston Martin':'aston-martin', Haas:'haas', Audi:'audi', Alpine:'alpine', Cadillac:'cadillac' };
let simulation = null;
let demoCars = [];
let demoRoute = null;
let pitEntryDistance = 0;
let pitExitDistance = 0;
const MAX_CARS_IN_PIT_LANE = 2;
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
function crossedTrackPoint(from, to, point) { return from <= to ? from < point && to >= point : from < point || to >= point; }
function crossedTrackPointReverse(from, to, point) { return from >= to ? from > point && to <= point : from > point || to <= point; }
function routeDistanceAtPoint(route, point) {
  const length = route.getTotalLength();
  let nearest = 0, closest = Infinity;
  for (let step = 0; step <= 1200; step += 1) {
    const candidate = route.getPointAtLength(length * step / 1200);
    const distance = (candidate.x - point.x) ** 2 + (candidate.y - point.y) ** 2;
    if (distance < closest) { closest = distance; nearest = step; }
  }
  return nearest / 1200 * 1000;
}

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
    state.sessionData = { positions, stints, intervals, laps, pit, overtakes };
    renderTower(positions, stints, intervals);
    renderRacePulse(positions, intervals, laps, overtakes, stints);
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
    return `<article class="timing-row ${item.position === 1 ? 'leader' : ''}" role="button" tabindex="0" data-driver-number="${item.driver_number}" aria-label="Open ${escapeHtml(driver.name_acronym || `car ${item.driver_number}`)} details">
      <div class="position">${item.position}</div><div class="driver"><span class="team-mark" style="background:#${driver.team_colour || '65748a'}"></span><div><div class="driver-name">${escapeHtml(driver.name_acronym || `CAR ${item.driver_number}`)}</div><div class="team-name">${escapeHtml(driver.team_name || '')}</div></div></div>
      <div class="tyre"><span class="tyre-dot" style="background:${tyreColor(stint.compound)}"></span><span>${stint.compound ? stint.compound.slice(0,3) : '—'} ${tyreAge}</span></div><div class="gap">${gap}</div></article>`;
  }).join('');
  tower.querySelectorAll('[data-driver-number]').forEach((row) => {
    const open = () => openDriverModal(Number(row.dataset.driverNumber));
    row.addEventListener('click', open);
    row.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
  });
}
function renderWeather(items) {
  const weather = latestBy(items); if (!weather) { $('weather-summary').textContent = '—'; return; }
  const condition = weather.rainfall ? 'WET' : 'DRY';
  $('weather-summary').textContent = `${weather.track_temperature?.toFixed(0) ?? '—'}° · ${condition}`;
}
function renderRacePulse(positions, intervals, laps, overtakes, stints = []) {
  const order = uniqueLatest(positions, 'driver_number').sort((a, b) => a.position - b.position);
  const intervalMap = new Map(uniqueLatest(intervals, 'driver_number').map(item => [item.driver_number, item]));
  const stintMap = new Map(uniqueLatest(stints, 'driver_number').map(item => [item.driver_number, item]));
  if (!order.length) return empty('race-pulse');
  const visibleOrder = document.body.classList.contains('full-mode') ? order : order.slice(0, 8);
  $('race-pulse').innerHTML = visibleOrder.map((item) => {
    const driver = state.drivers.get(item.driver_number) || {};
    const interval = intervalMap.get(item.driver_number) || {};
    const stint = stintMap.get(item.driver_number) || {};
    const gap = item.position === 1 ? 'LEADER' : interval.gap_to_leader != null ? `+${Number(interval.gap_to_leader).toFixed(1)}` : '—';
    const tyre = stint.compound ? stint.compound.charAt(0) : '—';
    const colour = `#${driver.team_colour || '65748a'}`;
    return `<article class="mini-timing-row ${item.position === 1 ? 'mini-leader' : ''}"><span class="mini-position">${item.position}</span><span class="mini-team" style="background:${colour}"></span><strong>${escapeHtml(driver.name_acronym || `CAR ${item.driver_number}`)}</strong><span class="mini-gap">${gap}</span><span class="mini-tyre" style="color:${tyreColor(stint.compound)}">${tyre}</span></article>`;
  }).join('');
}
function driverName(number) { return state.drivers.get(number)?.name_acronym || `CAR ${number}`; }
function valueOrDash(value, suffix = '') { return value == null || value === '' || !Number.isFinite(Number(value)) ? '—' : `${value}${suffix}`; }
function openDriverModal(driverNumber) {
  const data = state.sessionData;
  const driver = state.drivers.get(driverNumber);
  if (!data || !driver) return;
  state.selectedDriver = driverNumber;
  const latestPosition = latestBy(data.positions.filter(item => item.driver_number === driverNumber));
  const firstPosition = [...data.positions].filter(item => item.driver_number === driverNumber).sort((a, b) => new Date(a.date) - new Date(b.date))[0];
  const stint = latestBy(data.stints.filter(item => item.driver_number === driverNumber));
  const interval = latestBy(data.intervals.filter(item => item.driver_number === driverNumber));
  const driverLaps = data.laps.filter(item => item.driver_number === driverNumber);
  const latestLap = latestBy(driverLaps, 'date_start');
  const bestLap = Math.min(...driverLaps.map(item => Number(item.lap_duration)).filter(Number.isFinite));
  const pitStops = data.pit.filter(item => item.driver_number === driverNumber);
  const madePasses = data.overtakes.filter(item => item.overtaking_driver_number === driverNumber).length;
  const lostPasses = data.overtakes.filter(item => item.overtaken_driver_number === driverNumber).length;
  const position = latestPosition?.position;
  const grid = data.gridPositions?.get(driverNumber) || firstPosition?.position;
  const movement = Number.isFinite(position) && Number.isFinite(grid) ? grid - position : null;
  const tyreAge = stint?.tyre_age_at_start != null && stint?.lap_start != null ? stint.tyre_age_at_start + Math.max(0, (latestLap?.lap_number || stint.lap_end || stint.lap_start) - stint.lap_start) : null;
  const speed = latestLap ? Math.max(latestLap.st_speed || 0, latestLap.i1_speed || 0, latestLap.i2_speed || 0) : null;
  const displayName = driver.full_name || driver.broadcast_name || driver.name_acronym || `Car ${driverNumber}`;
  const colour = `#${driver.team_colour || '65748a'}`;
  const sprite = CAR_SPRITES[driver.team_name];
  $('driver-modal-name').textContent = displayName;
  $('driver-modal-team').textContent = driver.team_name || 'Formula 1';
  $('driver-modal-position').textContent = position ? `P${position}` : 'P—';
  $('driver-modal-movement').textContent = grid ? `STARTED P${grid}${movement === null ? '' : movement > 0 ? ` · +${movement} GAINED` : movement < 0 ? ` · ${movement} LOST` : ' · HOLDING'}` : 'GRID POSITION UNAVAILABLE';
  $('driver-car-side').style.setProperty('--team-colour', colour);
  $('driver-car-side').innerHTML = `<span class="driver-car-number">${driver.driver_number || '—'}</span>${sprite ? `<img src="assets/cars/${sprite}.png" alt="${escapeHtml(driver.team_name || 'Race')} car">` : '<div class="driver-car-placeholder">RACE CAR</div>'}`;
  const gap = position === 1 ? 'Leader' : interval?.gap_to_leader != null ? `+${Number(interval.gap_to_leader).toFixed(3)} s` : '—';
  const specs = [
    ['Race position', position ? `P${position}` : '—'], ['Gap to leader', gap],
    ['Last lap speed', speed ? `${speed} km/h` : '—'], ['Current tyre', stint?.compound || '—'],
    ['Tyre age', tyreAge != null ? `${tyreAge} laps` : '—'], ['Current lap', latestLap?.lap_number ? `Lap ${latestLap.lap_number}` : '—'],
    ['Pit stops', `${pitStops.length}`], ['Best lap', Number.isFinite(bestLap) ? `${Math.floor(bestLap / 60)}:${(bestLap % 60).toFixed(3).padStart(6, '0')}` : '—'],
    ['Overtakes', `${madePasses} made · ${lostPasses} lost`], ['Grid position', grid ? `P${grid}` : '—']
  ];
  $('driver-modal-specs').innerHTML = specs.map(([label, value]) => `<div class="driver-spec"><span>${label}</span><strong>${value}</strong></div>`).join('');
  $('driver-modal-footer').textContent = `Last timing sample: ${time(latestPosition?.date || latestLap?.date_start)} · click outside to close`;
  $('driver-modal').hidden = false;
  document.body.classList.add('modal-open');
  $('driver-modal').querySelector('.driver-modal-close').focus();
}
function closeDriverModal() { $('driver-modal').hidden = true; state.selectedDriver = null; document.body.classList.remove('modal-open'); }
document.querySelectorAll('[data-close-driver-modal]').forEach(button => button.addEventListener('click', closeDriverModal));
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('driver-modal').hidden) closeDriverModal(); });
function renderPit(items) { const stops = [...items].sort((a,b) => new Date(b.date)-new Date(a.date)).slice(0,5); $('pit-count').textContent=`${items.length} STOP${items.length===1?'':'S'}`; if (!stops.length) { $('pit-stops').innerHTML='<p class="empty-state">PIT LANE CLEAR</p>'; return; } $('pit-stops').innerHTML=stops.map(p=>`<div class="event"><span class="event-badge">L${p.lap_number ?? '—'}</span><strong>${driverName(p.driver_number)}</strong><small>${p.stop_duration ? `${p.stop_duration.toFixed(1)}s stop` : 'Pit lane'}<br>${time(p.date)}</small></div>`).join(''); }
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
    element.innerHTML = `<image href="assets/cars/${sprite}-sprite.png" x="-16" y="-8" width="32" height="16" preserveAspectRatio="xMidYMid meet"/><text x="14" y="-7" fill="#${driver.team_colour}" style="font:700 6px Inter,sans-serif;paint-order:stroke;stroke:#080c13;stroke-width:2px">${driver.name_acronym}</text>`;
    carLayer.append(element);
    return { driver, element, distance: 190 - index * 10, totalDistance:190 - index * 10, pace:7.3 + Math.random() * .7, target:null, trackVelocity:0, pit:null, pitStops:0, plannedStops:1 + Math.floor(Math.random() * 3), pitRequested:false, nextPitLap:2 + Math.floor(Math.random() * 4), lastPitLap:-Infinity };
  });
  demoCars = cars;
  const routeLength = route.getTotalLength();
  const pitPath = $('demo-track').querySelector('.pit-route');
  pitEntryDistance = routeDistanceAtPoint(route, pitPath.getPointAtLength(pitPath.getTotalLength()));
  pitExitDistance = routeDistanceAtPoint(route, pitPath.getPointAtLength(0));
  const startLineDistance = routeDistanceAtPoint(route, { x:117, y:200 });
  cars.forEach((car, index) => {
    // Cars travel towards decreasing route distance. Lower distance is therefore ahead on track.
    const gridDistance = (startLineDistance + 7 + index * 8 + 1000) % 1000;
    car.distance = gridDistance;
    // Keep the visual grid order and race-order calculation aligned from the first frame.
    car.totalDistance = 900 - index * 8;
  });
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
      const raceLap = simulation?.lap || 1;
      if (!car.pit && car.pitStops < car.plannedStops && raceLap >= car.nextPitLap && raceLap - car.lastPitLap >= 9) car.pitRequested = true;
      if (car.pit) {
        const elapsed = replayTime - car.pit.started;
        const entry = 1.15, total = entry + car.pit.duration + 1.15;
        let progress = elapsed < entry ? elapsed / entry * .5 : elapsed < entry + car.pit.duration ? .5 : .5 + ((elapsed - entry - car.pit.duration) / 1.15) * .5;
        progress = Math.max(0, Math.min(1, progress));
        const pitPath = $('demo-track').querySelector('.pit-route');
        const pitDistance = pitPath.getTotalLength() * (1 - progress);
        const pitPoint = pitPath.getPointAtLength(pitDistance);
        const pitAhead = pitPath.getPointAtLength(Math.max(0, pitDistance - 2));
        const pitAngle = Math.atan2(pitAhead.y - pitPoint.y, pitAhead.x - pitPoint.x) * 180 / Math.PI;
        car.element.setAttribute('transform', `translate(${pitPoint.x} ${pitPoint.y}) rotate(${pitAngle})`);
        if (elapsed >= total) {
          if (simulation && car.pit.stop) {
            simulation.activePits = simulation.activePits.filter((stop) => stop !== car.pit.stop);
            renderPit(simulation.activePits);
          }
          car.pit = null; car.distance = pitExitDistance; car.target = null; car.pitRequested = false;
        }
        continue;
      }
      const previousDistance = car.distance;
      if (target == null) car.distance = (car.distance - car.pace * delta + 1000) % 1000;
      else {
        if (car.target !== target) {
          let backwardDistance = (car.distance - target + 1000) % 1000;
          if (backwardDistance > 140) backwardDistance = 32;
          car.target = target;
          car.trackVelocity = Math.min(32, backwardDistance / (1.8 / demoSpeed));
        }
        car.distance = (car.distance - car.trackVelocity * delta + 1000) % 1000;
      }
      car.totalDistance += (target == null ? car.pace : car.trackVelocity) * delta;
      const passedPitEntry = crossedTrackPointReverse(previousDistance, car.distance, pitEntryDistance);
      const carsInPit = cars.filter((item) => item.pit).length;
      if (car.pitRequested && passedPitEntry && carsInPit < MAX_CARS_IN_PIT_LANE) {
        car.pit = { started:replayTime, duration:1.6 + Math.random() * .7 };
        car.pitStops += 1;
        car.lastPitLap = raceLap;
        car.nextPitLap = raceLap + 9 + Math.floor(Math.random() * 8);
        car.distance = 0;
        car.pit.stop = registerPitStop(car, car.pit.duration);
      }
      const point = route.getPointAtLength((car.distance / 1000) * routeLength);
      const ahead = route.getPointAtLength((((car.distance - 2 + 1000) % 1000) / 1000) * routeLength);
      const angle = Math.atan2(ahead.y - point.y, ahead.x - point.x) * 180 / Math.PI;
      car.element.setAttribute('transform', `translate(${point.x} ${point.y}) rotate(${angle})`);
    }
    if (!simulation) { const lap = phase < 7 ? 13 : phase < 14 ? 15 : 16; $('demo-lap').textContent = `LAP ${lap} / 18`; }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function registerPitStop(car, duration) {
  const driver = car.driver;
  const stop = { date:new Date().toISOString(), driver_number:driver.driver_number, lap_number:simulation?.lap || '—', stop_duration:+duration.toFixed(1) };
  if (simulation) {
    simulation.pits.unshift(stop);
    simulation.activePits.unshift(stop);
    simulation.control.unshift({ date:stop.date, category:'Race Control', flag:'PIT', message:`${driver.name_acronym} ENTERS THE PIT LANE` });
    renderPit(simulation.activePits);
    renderControl(simulation.control);
  }
  $('demo-commentary').innerHTML = `<span><b style="background:#${driver.team_colour}"></b>${driver.name_acronym} is in the pit lane</span><span class="demo-speed">STOPPING FOR ${stop.stop_duration.toFixed(1)} SECONDS</span>`;
  return stop;
}
function renderLiveRaceUpdate(sim) {
  const latestPass = sim.overtakes[0];
  const leader = state.drivers.get(sim.order[0]) || {};
  if (latestPass) {
    const passing = state.drivers.get(latestPass.overtaking_driver_number) || {};
    const passed = state.drivers.get(latestPass.overtaken_driver_number) || {};
    $('demo-commentary').innerHTML = `<span><b style="background:#${passing.team_colour || 'c8d0db'}"></b><strong>OVERTAKE</strong> · ${passing.name_acronym || 'CAR'} passes ${passed.name_acronym || 'CAR'} for P${latestPass.position ?? '—'}</span><span class="demo-speed">LAP ${sim.lap} · LIVE RACE UPDATE</span>`;
    return;
  }
  $('demo-commentary').innerHTML = `<span><b style="background:#${leader.team_colour || 'ff8700'}"></b><strong>RACE LEADER</strong> · ${leader.name_acronym || 'CAR'} leads the field</span><span class="demo-speed">LAP ${sim.lap} · FIELD RUNNING NORMALLY</span>`;
}
document.querySelectorAll('.speed-button').forEach((button) => {
  button.addEventListener('click', () => {
    demoSpeed = Number(button.dataset.speed);
    document.querySelectorAll('.speed-button').forEach((item) => item.classList.toggle('active', item === button));
  });
});

function startSimulator() {
  if (simulation) return;
  state.drivers = new Map(SIM_GRID.map(driver => [driver.driver_number, driver]));
  simulation = { lap: 1, trackPhase:0, tickCount:0, order: [...demoCars].sort((a,b) => b.totalDistance - a.totalDistance).map(car => car.driver.driver_number), overtakes: [], pits: [], activePits: [], control: [], timer: null, track:new Map(SIM_GRID.map((driver,index) => [driver.driver_number, 210 + index * 13])) };
  simulation.gridPositions = new Map(simulation.order.map((driverNumber, index) => [driverNumber, index + 1]));
  $('simulator-button').classList.add('active');
  $('simulator-button').textContent = 'LIVE SIM';
  $('session-select').disabled = true;
  $('data-notice').textContent = 'Race Simulator mode — full 2026 grid. Switch it off to return to OpenF1 historical sessions.';
  $('status-text').textContent = 'SIMULATING';
  function tick() {
    const sim = simulation; if (!sim) return;
    sim.tickCount += 1;
    const previousOrder = [...sim.order];
    sim.order = [...demoCars].sort((a,b) => b.totalDistance - a.totalDistance).map(car => car.driver.driver_number);
    let movedIndex = sim.order.findIndex((driver, index) => previousOrder.indexOf(driver) > index);
    let overtaker = movedIndex > 0 ? sim.order[movedIndex] : null;
    let overtaken = movedIndex > 0 ? previousOrder[movedIndex] : null;
    // Ensure a newly started demo shows an on-track event promptly, rather than
    // leaving the ticker on the leader message for its opening laps.
    if (!overtaker && sim.overtakes.length === 0 && sim.tickCount === 3) {
      const targetIndex = Math.min(5, sim.order.length - 1);
      const challenger = demoCars.find(car => car.driver.driver_number === sim.order[targetIndex]);
      const carAhead = demoCars.find(car => car.driver.driver_number === sim.order[targetIndex - 1]);
      if (challenger && carAhead) {
        challenger.totalDistance = carAhead.totalDistance + 0.01;
        sim.order = [...demoCars].sort((a,b) => b.totalDistance - a.totalDistance).map(car => car.driver.driver_number);
        movedIndex = sim.order.indexOf(challenger.driver.driver_number);
        overtaker = challenger.driver.driver_number;
        overtaken = previousOrder[movedIndex];
      }
    }
    const leader = demoCars.find((car) => car.driver.driver_number === sim.order[0]);
    sim.lap = Math.min(57, Math.max(sim.lap, Math.floor((leader?.totalDistance || 0) / 1000) + 1));
    sim.trackPhase = (sim.trackPhase - 55 + 1000) % 1000;
    if (overtaker) sim.overtakes.unshift({ date:new Date().toISOString(), overtaking_driver_number:overtaker, overtaken_driver_number:overtaken, position:movedIndex + 1 });
    if (overtaker) sim.control.unshift({ date:new Date().toISOString(), category:'Race Control', flag:'GREEN', message:`CAR ${state.drivers.get(overtaker).name_acronym} OVERTAKES ${state.drivers.get(overtaken).name_acronym} FOR P${movedIndex + 1}` });
    const positions = sim.order.map((driver_number, index) => ({ driver_number, position:index + 1, date:new Date().toISOString() }));
    positions.forEach((item, index) => sim.track.set(item.driver_number, (210 + sim.trackPhase + index * 13 + 1000) % 1000));
    const intervals = positions.map((item, index) => ({ driver_number:item.driver_number, date:item.date, gap_to_leader:index ? +(index * 1.06 + Math.random() * .42).toFixed(3) : null, interval:index ? +(.35 + Math.random() * .85).toFixed(3) : null }));
    const laps = positions.map(item => ({ driver_number:item.driver_number, lap_number:sim.lap, date_start:item.date, st_speed:306 + Math.floor(Math.random() * 44) }));
    const stints = positions.map(item => ({ driver_number:item.driver_number, compound:['SOFT','MEDIUM','HARD'][Math.floor((sim.lap + item.position) / 9) % 3], tyre_age_at_start:Math.max(0, sim.lap - (sim.lap % 9)), lap_start:sim.lap - (sim.lap % 9), lap_end:sim.lap }));
    state.sessionData = { positions, stints, intervals, laps, pit: sim.pits, overtakes: sim.overtakes, gridPositions: sim.gridPositions };
    renderTower(positions, stints, intervals); renderRacePulse(positions, intervals, laps, sim.overtakes, stints); renderPit(sim.activePits); renderOvertakes(sim.overtakes); renderControl(sim.control); renderLap(laps);
    if (state.selectedDriver) openDriverModal(state.selectedDriver);
    $('demo-lap').textContent = `LAP ${sim.lap} / 57`;
    renderLiveRaceUpdate(sim);
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
startDemoRace();
setTimeout(startSimulator, 250);
