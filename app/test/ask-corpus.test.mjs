// Ask corpus: realistic questions from people all over Sydney and NSW, each with what it means (intent and
// slots). Typos, lower case, no punctuation, slang and short forms included. Run against src/lib/askBrain.ts
// with the published station and suburb lists (backend/src/public/stations), a fixed clock (Monday 26 Oct 2026,
// 7:30 am Sydney) and saved places. Prints the pass rate by region and by mode; must stay at 90% or more.
// The "before" number is the old path: the question sent as typed, read by the server's own rules (the
// legacy reader below mirrors worker.js askRoute's order) with exact name matching only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ts = require(path.join(here, '..', 'node_modules', 'typescript'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nswapp-askcorpus-'));
async function load(rel) {
  const src = fs.readFileSync(path.join(here, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = path.join(out, path.basename(rel).replace(/\.ts$/, '.mjs'));
  fs.writeFileSync(f, js);
  return import(pathToFileURL(f).href);
}
const B = await load('src/lib/askBrain.ts');
const ST = path.join(here, '..', '..', 'backend', 'src', 'public', 'stations');
const readList = (n) => JSON.parse(fs.readFileSync(path.join(ST, n + '.json'), 'utf8'));
const gaz = B.buildGaz({ train: readList('train'), metro: readList('metro'), lightrail: readList('lightrail'), ferry: readList('ferry'), places: readList('places') });

const NOW = Date.parse('2026-10-25T20:30:00Z'); // Monday 26 Oct 2026, 7:30 am in Sydney
const CTX = {
  now: NOW, gaz,
  places: { home: { id: '275010', name: 'Penrith Station' }, work: { id: '200070', name: 'Martin Place Station' } },
  starred: [{ id: '206710', name: 'Chatswood Station' }, { id: '20991', name: 'Manly Wharf' }],
  recentTrips: [{ from: { id: '275010', name: 'Penrith Station' }, to: { id: '200070', name: 'Martin Place Station' } }],
  usual: [{ from: { id: '2154135', name: 'Castle Hill Station' }, to: { id: '2154250', name: 'Norwest Station' }, line: '619', mode: 'bus' }],
  hasLocation: false,
};

// [question, intent, slots, region, mode, previous question (for follow ups)]
// Regions: cbd, inner (inner west, inner south), east, north (north shore, northern beaches), west (Parramatta and
// beyond), southwest, south (St George, Sutherland Shire), hills (Hills and north west), regional (Blue Mountains,
// Central Coast, Newcastle and Hunter, Illawarra and South Coast, Southern Highlands, country NSW), network (no place).
export const CORPUS = [
  // Trips, train
  ['central to parramatta', 'trip', { from: 'Central', to: 'Parramatta' }, 'west', 'train'],
  ['parramata to town hall', 'trip', { from: 'Parramatta', to: 'Town Hall' }, 'west', 'train'],
  ['how do i get from hornsby to wynyard', 'trip', { from: 'Hornsby', to: 'Wynyard' }, 'north', 'train'],
  ['blacktown to the city', 'clarify', {}, 'west', 'train'],
  ['penrith 2 central', 'trip', { from: 'Penrith', to: 'Central' }, 'west', 'train'],
  ['liverpool to circular quay', 'trip', { from: 'Liverpool', to: 'Circular Quay' }, 'southwest', 'train'],
  ['campbeltown to central', 'trip', { from: 'Campbelltown', to: 'Central' }, 'southwest', 'train'],
  ['how do i get to bondi junction from redfern', 'trip', { from: 'Redfern', to: 'Bondi Junction' }, 'east', 'train'],
  ['hurstville to sydenham', 'trip', { from: 'Hurstville', to: 'Sydenham' }, 'south', 'train'],
  ['cronulla to central', 'trip', { from: 'Cronulla', to: 'Central' }, 'south', 'train'],
  ['sutherland to wolli creek', 'trip', { from: 'Sutherland', to: 'Wolli Creek' }, 'south', 'train'],
  ['epping to chatswood', 'trip', { from: 'Epping', to: 'Chatswood' }, 'north', 'metro'],
  ['richmond to blacktown', 'trip', { from: 'Richmond', to: 'Blacktown' }, 'west', 'train'],
  ['emu plains to parra', 'trip', { from: 'Emu Plains', to: 'Parramatta' }, 'west', 'train'],
  ['leppington to glenfield', 'trip', { from: 'Leppington', to: 'Glenfield' }, 'southwest', 'train'],
  ['bankstown to sydenham', 'trip', { from: 'Bankstown', to: 'Sydenham' }, 'southwest', 'metro'],
  ['ashfield to burwood', 'trip', { from: 'Ashfield', to: 'Burwood' }, 'inner', 'train'],
  ['marrickville to newtown', 'trip', { from: 'Marrickville', to: 'Newtown' }, 'inner', 'train'],
  ['st peters to erskineville', 'trip', { from: 'St Peters', to: 'Erskineville' }, 'inner', 'train'],
  ['north sydney to milsons point', 'trip', { from: 'North Sydney', to: 'Milsons Point' }, 'north', 'train'],
  ['gordon to pymble', 'trip', { from: 'Gordon', to: 'Pymble' }, 'north', 'train'],
  ['berowra to hornsby', 'trip', { from: 'Berowra', to: 'Hornsby' }, 'north', 'train'],
  ['strathfeild to kings x', 'trip', { from: 'Strathfield', to: 'Kings Cross' }, 'inner', 'train'],
  ['from mascot to green square', 'trip', { from: 'Mascot', to: 'Green Square' }, 'inner', 'train'],
  ['to edgecliff from martin place', 'trip', { from: 'Martin Place', to: 'Edgecliff' }, 'east', 'train'],
  ['granville to lidcombe', 'trip', { from: 'Granville', to: 'Lidcombe' }, 'west', 'train'],
  ['merrylands to harris park', 'trip', { from: 'Merrylands', to: 'Harris Park' }, 'west', 'train'],
  ['cabramatta to fairfield', 'trip', { from: 'Cabramatta', to: 'Fairfield' }, 'southwest', 'train'],
  ['macarthur to central', 'trip', { from: 'Macarthur', to: 'Central' }, 'southwest', 'train'],
  ['olympic park to lidcombe', 'trip', { from: 'Olympic Park', to: 'Lidcombe' }, 'west', 'train'],
  ['rhodes to meadowbank', 'trip', { from: 'Rhodes', to: 'Meadowbank' }, 'west', 'train'],
  ['wolli ck to kogarah', 'trip', { from: 'Wolli Creek', to: 'Kogarah' }, 'south', 'train'],
  ['how long from waterfall to central', 'trip', { from: 'Waterfall', to: 'Central' }, 'south', 'train'],
  // Trips, regional and intercity
  ['katoomba to central', 'trip', { from: 'Katoomba', to: 'Central' }, 'regional', 'train'],
  ['katomba to penrith', 'trip', { from: 'Katoomba', to: 'Penrith' }, 'regional', 'train'],
  ['blackheath to springwood', 'trip', { from: 'Blackheath', to: 'Springwood' }, 'regional', 'train'],
  ['lithgow to sydney', 'trip', { from: 'Lithgow', to: 'Sydney' }, 'regional', 'train'],
  ['gosford to hornsby', 'trip', { from: 'Gosford', to: 'Hornsby' }, 'regional', 'train'],
  ['woy woy to central', 'trip', { from: 'Woy Woy', to: 'Central' }, 'regional', 'train'],
  ['wyong to gosford', 'trip', { from: 'Wyong', to: 'Gosford' }, 'regional', 'train'],
  ['newcastle interchange to hamilton', 'trip', { from: 'Newcastle Interchange', to: 'Hamilton' }, 'regional', 'train'],
  ['maitland to newcastle', 'trip', { from: 'Maitland', to: 'Newcastle' }, 'regional', 'train'],
  ['wollongong to central', 'trip', { from: 'Wollongong', to: 'Central' }, 'regional', 'train'],
  ['woolongong to thirroul', 'trip', { from: 'Wollongong', to: 'Thirroul' }, 'regional', 'train'],
  ['kiama to wollongong', 'trip', { from: 'Kiama', to: 'Wollongong' }, 'regional', 'train'],
  ['bowral to campbelltown', 'trip', { from: 'Bowral', to: 'Campbelltown' }, 'regional', 'train'],
  ['moss vale to central', 'trip', { from: 'Moss Vale', to: 'Central' }, 'regional', 'train'],
  ['goulburn to sydney', 'trip', { from: 'Goulburn', to: 'Sydney' }, 'regional', 'coach'],
  ['bathurst to lithgow', 'trip', { from: 'Bathurst', to: 'Lithgow' }, 'regional', 'coach'],
  ['dubbo to orange', 'trip', { from: 'Dubbo', to: 'Orange' }, 'regional', 'coach'],
  ['central to albury', 'trip', { from: 'Central', to: 'Albury' }, 'regional', 'train'],
  ['port macquarie to newcastle', 'trip', { from: 'Port Macquarie', to: 'Newcastle' }, 'regional', 'coach'],
  // Trips, metro and light rail
  ['tallawong to chatswood', 'trip', { from: 'Tallawong', to: 'Chatswood' }, 'hills', 'metro'],
  ['castle hill to macquarie uni', 'trip', { from: 'Castle Hill', to: 'Macquarie University' }, 'hills', 'metro'],
  ['norwest to barangaroo', 'trip', { from: 'Norwest', to: 'Barangaroo' }, 'hills', 'metro'],
  ['rouse hill to crows nest', 'trip', { from: 'Rouse Hill', to: 'Crows Nest' }, 'hills', 'metro'],
  ['victoria cross to waterloo', 'trip', { from: 'Victoria Cross', to: 'Waterloo' }, 'north', 'metro'],
  ['kellyville to epping by metro', 'trip', { from: 'Kellyville', to: 'Epping', mode: 'metro' }, 'hills', 'metro'],
  ['randwick to circular quay on the light rail', 'trip', { from: 'Randwick', to: 'Circular Quay', mode: 'lightrail' }, 'east', 'lightrail'],
  ['kingsford to central light rail', 'trip', { from: 'Kingsford', to: 'Central', mode: 'lightrail' }, 'east', 'lightrail'],
  ['dulwich hill to star city', 'trip', { from: 'Dulwich Hill', to: 'Star City' }, 'inner', 'lightrail'],
  ['westmead to parramatta square', 'trip', { from: 'Westmead', to: 'Parramatta Square' }, 'west', 'lightrail'],
  ['carlingford to parramatta', 'trip', { from: 'Carlingford', to: 'Parramatta' }, 'west', 'lightrail'],
  ['newcastle beach to newcastle interchange', 'trip', { from: 'Newcastle Beach', to: 'Newcastle Interchange' }, 'regional', 'lightrail'],
  // Trips, ferry
  ['manly to circular quay', 'trip', { from: 'Manly', to: 'Circular Quay' }, 'north', 'ferry'],
  ['cq to manly by ferry', 'trip', { from: 'Circular Quay', to: 'Manly', mode: 'ferry' }, 'north', 'ferry'],
  ['circular quay to taronga zoo', 'trip', { from: 'Circular Quay', to: 'Taronga Zoo' }, 'north', 'ferry'],
  ['barangaroo to balmain east', 'trip', { from: 'Barangaroo', to: 'Balmain East' }, 'inner', 'ferry'],
  ['parramatta wharf to circular quay by ferry', 'trip', { from: 'Parramatta', to: 'Circular Quay', mode: 'ferry' }, 'west', 'ferry'],
  ['watsons bay to the quay', 'trip', { from: 'Watsons Bay', to: 'Circular Quay' }, 'east', 'ferry'],
  ['cockatoo island to circular quay', 'trip', { from: 'Cockatoo Island', to: 'Circular Quay' }, 'inner', 'ferry'],
  ['neutral bay to cq', 'trip', { from: 'Neutral Bay', to: 'Circular Quay' }, 'north', 'ferry'],
  ['mosman bay to circular quay', 'trip', { from: 'Mosman Bay', to: 'Circular Quay' }, 'north', 'ferry'],
  ['palm beach to ettalong', 'trip', { from: 'Palm Beach', to: 'Ettalong' }, 'north', 'ferry'],
  // Trips, bus and places that are not stations
  ['how do i get to bondi beach', 'trip', { to: 'Bondi Beach' }, 'east', 'bus'],
  ['coogee to bondi junction', 'trip', { from: 'Coogee', to: 'Bondi Junction' }, 'east', 'bus'],
  ['maroubra to central by bus', 'trip', { from: 'Maroubra', to: 'Central', mode: 'bus' }, 'east', 'bus'],
  ['dee why to manly', 'trip', { from: 'Dee Why', to: 'Manly' }, 'north', 'bus'],
  ['mona vale to wynyard', 'trip', { from: 'Mona Vale', to: 'Wynyard' }, 'north', 'bus'],
  ['brookvale to chatswood', 'trip', { from: 'Brookvale', to: 'Chatswood' }, 'north', 'bus'],
  ['narrabeen to dee why', 'trip', { from: 'Narrabeen', to: 'Dee Why' }, 'north', 'bus'],
  ['baulkham hills to parramatta', 'trip', { from: 'Baulkham Hills', to: 'Parramatta' }, 'hills', 'bus'],
  ['how do i get to westmead hospital from blacktown', 'trip', { from: 'Blacktown', to: 'Westmead Hospital' }, 'west', 'bus'],
  ['get me to macquarie centre', 'trip', { to: 'Macquarie Centre' }, 'north', 'bus'],
  ['take me to the opera house', 'trip', { to: 'Opera House' }, 'cbd', 'any'],
  ['how to get to unsw from central', 'trip', { from: 'Central', to: 'UNSW' }, 'east', 'any'],
  ['directions to rpa hospital', 'trip', { to: 'RPA Hospital' }, 'inner', 'any'],
  ['i need to go to the domestic airport', 'trip', { to: 'Domestic Airport' }, 'inner', 'train'],
  ['fastest way to the airport', 'clarify', {}, 'inner', 'train'],
  ['international airport to central', 'trip', { from: 'International Airport', to: 'Central' }, 'inner', 'train'],
  ['how do i get to uni', 'clarify', {}, 'network', 'any'],
  ['to the beach', 'clarify', {}, 'network', 'any'],
  ['bondi beach to coogee', 'trip', { from: 'Bondi Beach', to: 'Coogee' }, 'east', 'bus'],
  ['liverpool hospital to liverpool station', 'trip', { from: 'Liverpool Hospital', to: 'Liverpool' }, 'southwest', 'any'],
  ['westfield parramatta to rydalmere', 'trip', { from: 'Westfield Parramatta', to: 'Rydalmere' }, 'west', 'any'],
  ['castle towers to rouse hill', 'trip', { from: 'Castle Towers', to: 'Rouse Hill' }, 'hills', 'bus'],
  ['im heading to darling harbour', 'trip', { to: 'Darling Harbour' }, 'cbd', 'any'],
  ['george st to the rocks', 'trip', { from: 'George St', to: 'The Rocks' }, 'cbd', 'any'],
  ['penrith to the blue mountains', 'trip', { from: 'Penrith', to: 'Blue Mountains' }, 'regional', 'train'],
  ['how do i get to the entrance from gosford', 'trip', { from: 'Gosford', to: 'The Entrance' }, 'regional', 'bus'],
  ['charlestown to newcastle by bus', 'trip', { from: 'Charlestown', to: 'Newcastle', mode: 'bus' }, 'regional', 'bus'],
  ['shellharbour to wollongong', 'trip', { from: 'Shellharbour', to: 'Wollongong' }, 'regional', 'train'],
  ['nowra to central', 'trip', { from: 'Nowra', to: 'Central' }, 'regional', 'train'],
  ['wagga to sydney', 'trip', { from: 'Wagga Wagga', to: 'Sydney' }, 'regional', 'coach'],
  ['tamworth to newcastle', 'trip', { from: 'Tamworth', to: 'Newcastle' }, 'regional', 'coach'],
  ['bega to canberra', 'trip', { from: 'Bega', to: 'Canberra' }, 'regional', 'coach'],
  ['byron bay to lismore', 'trip', { from: 'Byron Bay', to: 'Lismore' }, 'regional', 'coach'],
  ['chatswood to hornsby via epping', 'trip', { from: 'Chatswood', to: 'Hornsby', via: 'Epping' }, 'north', 'train'],
  ['parramatta to central no changes', 'trip', { from: 'Parramatta', to: 'Central', direct: true }, 'west', 'train'],
  ['blacktown to town hall direct', 'trip', { from: 'Blacktown', to: 'Town Hall', direct: true }, 'west', 'train'],
  ['step free trip from wynyard to central', 'trip', { from: 'Wynyard', to: 'Central', acc: true }, 'cbd', 'train'],
  ['home to work', 'trip', { from: 'home', to: 'work' }, 'network', 'any'],
  ['work to home', 'trip', { from: 'work', to: 'home' }, 'network', 'any'],
  ['how do i get home from bondi', 'trip', { from: 'Bondi', to: 'home' }, 'east', 'any'],
  ['take me home', 'trip', { to: 'home' }, 'network', 'any'],
  ['next train to central', 'trip', { to: 'Central', mode: 'train' }, 'cbd', 'train'],
  ['next train to hornsby', 'trip', { to: 'Hornsby', mode: 'train' }, 'north', 'train'],
  ['next ferry to manly', 'trip', { to: 'Manly', mode: 'ferry' }, 'north', 'ferry'],
  ['next bus to maroubra junction', 'trip', { to: 'Maroubra Junction', mode: 'bus' }, 'east', 'bus'],
  // Times and days
  ['trains after 6pm tomorrow to parramatta', 'trip', { to: 'Parramatta', mode: 'train', time: '18:00', date: '2026-10-27' }, 'west', 'train'],
  ['central to hornsby after 6', 'trip', { from: 'Central', to: 'Hornsby', time: '18:00' }, 'north', 'train'],
  ['wynyard to chatswood around 8:30', 'trip', { from: 'Wynyard', to: 'Chatswood', time: '08:30' }, 'north', 'train'],
  ['leave at 8 arrive by 9 at north sydney', 'trip', { to: 'North Sydney', time: '09:00', arriveBy: true }, 'north', 'any'],
  ['i need to be at macquarie park by 9am from epping', 'trip', { from: 'Epping', to: 'Macquarie Park', time: '09:00', arriveBy: true }, 'north', 'metro'],
  ['liverpool to parramatta tomorrow morning', 'trip', { from: 'Liverpool', to: 'Parramatta', time: '06:00', date: '2026-10-27' }, 'southwest', 'any'],
  ['manly to cq tonight', 'trip', { from: 'Manly', to: 'Circular Quay', time: '18:00' }, 'north', 'ferry'],
  ['gosford to central this weekend', 'trip', { from: 'Gosford', to: 'Central', date: '2026-10-31' }, 'regional', 'train'],
  ['hurstville to central in 20 min', 'trip', { from: 'Hurstville', to: 'Central', time: '07:50' }, 'south', 'train'],
  ['penrith to blacktown at 5:15pm', 'trip', { from: 'Penrith', to: 'Blacktown', time: '17:15' }, 'west', 'train'],
  ['town hall to bondi junction at half past 7', 'trip', { from: 'Town Hall', to: 'Bondi Junction', time: '07:30' }, 'east', 'train'],
  ['circular quay to manly on saturday at 10am', 'trip', { from: 'Circular Quay', to: 'Manly', time: '10:00', date: '2026-10-31' }, 'north', 'ferry'],
  ['katoomba to central friday arvo', 'trip', { from: 'Katoomba', to: 'Central', time: '12:00', date: '2026-10-30' }, 'regional', 'train'],
  ['wollongong to central tmrw 7am', 'trip', { from: 'Wollongong', to: 'Central', time: '07:00', date: '2026-10-27' }, 'regional', 'train'],
  ['cronulla to sutherland before 9', 'trip', { from: 'Cronulla', to: 'Sutherland', time: '09:00', arriveBy: true }, 'south', 'train'],
  ['epping to tallawong in an hour', 'trip', { from: 'Epping', to: 'Tallawong', time: '08:30' }, 'hills', 'metro'],
  ['chatswood to central arriving by 8:45', 'trip', { from: 'Chatswood', to: 'Central', time: '08:45', arriveBy: true }, 'north', 'train'],
  ['newcastle to maitland at 11pm', 'trip', { from: 'Newcastle', to: 'Maitland', time: '23:00' }, 'regional', 'train'],
  ['dee why to manly at noon', 'trip', { from: 'Dee Why', to: 'Manly', time: '12:00' }, 'north', 'bus'],
  // Departures
  ['when is the next 410 from strathfield', 'departures', { line: '410', stop: 'Strathfield' }, 'inner', 'bus'],
  ['next 333 from bondi beach', 'departures', { line: '333', stop: 'Bondi Beach' }, 'east', 'bus'],
  ['when does the b1 leave mona vale', 'departures', { line: 'B1', stop: 'Mona Vale' }, 'north', 'bus'],
  ['m52 from parramatta', 'departures', { line: 'M52', stop: 'Parramatta' }, 'west', 'bus'],
  ['trains from central', 'departures', { stop: 'Central', mode: 'train' }, 'cbd', 'train'],
  ['next bus from bondi junction', 'departures', { stop: 'Bondi Junction', mode: 'bus' }, 'east', 'bus'],
  ['next ferry from manly', 'departures', { stop: 'Manly', mode: 'ferry' }, 'north', 'ferry'],
  ['departures parramatta', 'departures', { stop: 'Parramatta' }, 'west', 'train'],
  ['hornsby', 'departures', { stop: 'Hornsby' }, 'north', 'train'],
  ['chatswod', 'departures', { stop: 'Chatswood' }, 'north', 'train'],
  ['town hall station', 'departures', { stop: 'Town Hall' }, 'cbd', 'train'],
  ['manly wharf', 'departures', { stop: 'Manly' }, 'north', 'ferry'],
  ['metro from tallawong', 'departures', { stop: 'Tallawong', mode: 'metro' }, 'hills', 'metro'],
  ['light rail from randwick', 'departures', { stop: 'Randwick', mode: 'lightrail' }, 'east', 'lightrail'],
  ['whats leaving wynyard', 'departures', { stop: 'Wynyard' }, 'cbd', 'train'],
  ['next train from gosford', 'departures', { stop: 'Gosford', mode: 'train' }, 'regional', 'train'],
  ['buses from wollongong', 'departures', { stop: 'Wollongong', mode: 'bus' }, 'regional', 'bus'],
  ['nxt trian from katoomba', 'departures', { stop: 'Katoomba', mode: 'train' }, 'regional', 'train'],
  ['trains from central after 6pm', 'departures', { stop: 'Central', mode: 'train', time: '18:00' }, 'cbd', 'train'],
  ['ferries from circular quay tomorrow at 9', 'departures', { stop: 'Circular Quay', mode: 'ferry', time: '09:00', date: '2026-10-27' }, 'cbd', 'ferry'],
  ['when is the next t4 at bondi junction', 'departures', { line: 'T4', stop: 'Bondi Junction' }, 'east', 'train'],
  ['parramatta light rail times from westmead', 'departures', { stop: 'Westmead', line: 'L4' }, 'west', 'lightrail'],
  ['next f1', 'departures', { line: 'F1' }, 'north', 'ferry'],
  ['buses from macquarie park', 'departures', { stop: 'Macquarie Park', mode: 'bus' }, 'north', 'bus'],
  ['next 610x from castle hill', 'departures', { line: '610X', stop: 'Castle Hill' }, 'hills', 'bus'],
  ['newcastle interchange departures', 'departures', { stop: 'Newcastle Interchange' }, 'regional', 'train'],
  // Last service
  ['last train home', 'last', { to: 'home', mode: 'train' }, 'network', 'train'],
  ['last train to penrith', 'last', { to: 'Penrith', mode: 'train' }, 'west', 'train'],
  ['when is the last ferry from manly to circular quay', 'last', { from: 'Manly', to: 'Circular Quay', mode: 'ferry' }, 'north', 'ferry'],
  ['last bus to bondi beach', 'last', { to: 'Bondi Beach', mode: 'bus' }, 'east', 'bus'],
  ['whats the last metro to tallawong', 'last', { to: 'Tallawong', mode: 'metro' }, 'hills', 'metro'],
  ['last train from central to wollongong tonight', 'last', { from: 'Central', to: 'Wollongong', mode: 'train' }, 'regional', 'train'],
  ['latest train to katoomba', 'last', { to: 'Katoomba', mode: 'train' }, 'regional', 'train'],
  ['final bus home', 'last', { to: 'home', mode: 'bus' }, 'network', 'bus'],
  ['last service to gosford', 'last', { to: 'Gosford' }, 'regional', 'train'],
  ['last light rail to randwick', 'last', { to: 'Randwick', mode: 'lightrail' }, 'east', 'lightrail'],
  // Delays and disruption
  ['is the t1 running late', 'status', { line: 'T1' }, 'network', 'train'],
  ['any delays on the t4', 'status', { line: 'T4' }, 'network', 'train'],
  ['is the north shore line ok', 'status', { line: 'T1' }, 'north', 'train'],
  ['t8 delays', 'status', { line: 'T8' }, 'network', 'train'],
  ['how is the metro running', 'status', { line: 'M1' }, 'network', 'metro'],
  ['are trains running late', 'status', { mode: 'train' }, 'network', 'train'],
  ['is the manly ferry running', 'status', { line: 'F1' }, 'north', 'ferry'],
  ['are the ferries cancelled', 'status', { mode: 'ferry' }, 'network', 'ferry'],
  ['blue mountains line delays', 'status', { line: 'BMT' }, 'regional', 'train'],
  ['is the central coast line working', 'status', { line: 'CCN' }, 'regional', 'train'],
  ['any problems on the l2', 'status', { line: 'L2' }, 'east', 'lightrail'],
  ['is the 333 late', 'status', { line: '333' }, 'east', 'bus'],
  ['whats wrong with the t3', 'status', { line: 'T3' }, 'network', 'train'],
  ['south coast line status', 'status', { line: 'SCO' }, 'regional', 'train'],
  ['is the hunter line running', 'status', { line: 'HUN' }, 'regional', 'train'],
  ['delays on the illawarra line', 'status', { line: 'T4' }, 'south', 'train'],
  ['is the t9 delayd', 'status', { line: 'T9' }, 'network', 'train'],
  ['any bus disruptions', 'status', { mode: 'bus' }, 'network', 'bus'],
  // Trackwork
  ['any trackwork this weekend', 'trackwork', { when: 'weekend' }, 'network', 'train'],
  ['trackwork on the t1', 'trackwork', { line: 'T1' }, 'network', 'train'],
  ['is there trackwork on the blue mountains line this weekend', 'trackwork', { line: 'BMT', when: 'weekend' }, 'regional', 'train'],
  ['are buses replacing trains on the t2', 'trackwork', { line: 'T2' }, 'network', 'train'],
  ['metro closed this weekend', 'trackwork', { line: 'M1', when: 'weekend' }, 'network', 'metro'],
  ['trackwrk t4 wknd', 'trackwork', { line: 'T4', when: 'weekend' }, 'network', 'train'],
  ['planned work on the central coast line', 'trackwork', { line: 'CCN' }, 'regional', 'train'],
  ['is the l1 shut', 'trackwork', { line: 'L1' }, 'inner', 'lightrail'],
  // Car parks
  ['parking at ashfield', 'parking', { stop: 'Ashfield' }, 'inner', 'train'],
  ['any parking at gordon station', 'parking', { stop: 'Gordon' }, 'north', 'train'],
  ['commuter car park kellyville', 'parking', { stop: 'Kellyville' }, 'hills', 'metro'],
  ['is the car park full at campbelltown', 'parking', { stop: 'Campbelltown' }, 'southwest', 'train'],
  ['how many spaces at tallawong', 'parking', { stop: 'Tallawong' }, 'hills', 'metro'],
  ['park and ride at warwick farm', 'parking', { stop: 'Warwick Farm' }, 'southwest', 'train'],
  ['parkin at penrith', 'parking', { stop: 'Penrith' }, 'west', 'train'],
  ['car parks at gosford', 'parking', { stop: 'Gosford' }, 'regional', 'train'],
  ['where can i park', 'clarify', {}, 'network', 'any'],
  // Lifts and access
  ['lift at redfern', 'lift', { stop: 'Redfern' }, 'inner', 'train'],
  ['are the lifts working at town hall', 'lift', { stop: 'Town Hall' }, 'cbd', 'train'],
  ['is wynyard step free', 'lift', { stop: 'Wynyard' }, 'cbd', 'train'],
  ['escalators at central', 'lift', { stop: 'Central' }, 'cbd', 'train'],
  ['wheelchair access at newcastle interchange', 'lift', { stop: 'Newcastle Interchange' }, 'regional', 'train'],
  ['lifts out at parramatta', 'lift', { stop: 'Parramatta' }, 'west', 'train'],
  ['does milsons point have a lift', 'lift', { stop: 'Milsons Point' }, 'north', 'train'],
  ['manly wharf accessible', 'lift', { stop: 'Manly' }, 'north', 'ferry'],
  // Fares
  ['how much is opal to central', 'fare', { to: 'Central' }, 'cbd', 'train'],
  ['fare from penrith to central', 'fare', { from: 'Penrith', to: 'Central' }, 'west', 'train'],
  ['how much does it cost from manly to circular quay', 'fare', { from: 'Manly', to: 'Circular Quay' }, 'north', 'ferry'],
  ['opal fare wollongong to central', 'fare', { from: 'Wollongong', to: 'Central' }, 'regional', 'train'],
  ['price hornsby to chatswood', 'fare', { from: 'Hornsby', to: 'Chatswood' }, 'north', 'train'],
  ['cost to the airport from central', 'clarify', {}, 'inner', 'train'],
  ['how much is it', 'clarify', {}, 'network', 'any'],
  // My bus, near me
  ['when does my bus come', 'mybus', { mode: 'bus' }, 'network', 'bus'],
  ['where is my bus', 'mybus', { mode: 'bus' }, 'network', 'bus'],
  ['wheres my train', 'mybus', { mode: 'train' }, 'network', 'train'],
  ['is my bus on time', 'mybus', { mode: 'bus' }, 'network', 'bus'],
  ['stops near me', 'nearby', {}, 'network', 'any'],
  ['nearest station', 'nearby', {}, 'network', 'train'],
  ['closest bus stop', 'nearby', { mode: 'bus' }, 'network', 'bus'],
  // Small talk
  ['thanks', 'thanks', {}, 'network', 'any'],
  ['hi', 'help', {}, 'network', 'any'],
  ['asdf qwerty', 'clarify', {}, 'network', 'any'],
  // Follow ups
  ['and the one after', 'later', { from: 'Chatswood', to: 'Hornsby' }, 'north', 'train', 'chatswood to hornsby'],
  ['and later?', 'later', { from: 'Parramatta', to: 'Central' }, 'west', 'train', 'parramatta to central'],
  ['the one after that', 'later', { stop: 'Manly' }, 'north', 'ferry', 'next ferry from manly'],
  ['earlier', 'earlier', { from: 'Gosford', to: 'Central' }, 'regional', 'train', 'gosford to central'],
  ['what about by bus', 'trip', { from: 'Coogee', to: 'Central', mode: 'bus' }, 'east', 'bus', 'coogee to central'],
  ['by ferry instead', 'trip', { from: 'Parramatta', to: 'Circular Quay', mode: 'ferry' }, 'west', 'ferry', 'parramatta to circular quay'],
  ['what about the metro', 'trip', { from: 'Epping', to: 'Chatswood', mode: 'metro' }, 'north', 'metro', 'epping to chatswood by train'],
  ['and from there to bondi beach', 'trip', { from: 'Bondi Junction', to: 'Bondi Beach' }, 'east', 'bus', 'central to bondi junction'],
  ['what about tomorrow', 'trip', { from: 'Hornsby', to: 'Central', date: '2026-10-27' }, 'north', 'train', 'hornsby to central'],
  ['and the way back', 'trip', { from: 'Newcastle', to: 'Maitland' }, 'regional', 'train', 'maitland to newcastle'],
  ['what about to wynyard', 'trip', { from: 'Penrith', to: 'Wynyard' }, 'west', 'train', 'penrith to central'],
  ['and parramatta', 'parking', { stop: 'Parramatta' }, 'west', 'train', 'parking at blacktown'],
  ['and the one after?', 'clarify', {}, 'network', 'any'],
  ['from there', 'departures', { stop: 'Wollongong' }, 'regional', 'train', 'central to wollongong'],
  ['what about saturday', 'trip', { from: 'Manly', to: 'Circular Quay', date: '2026-10-31' }, 'north', 'ferry', 'manly to circular quay'],
  // Second batch, written after the first passed and run once before any fix (the held out number in the report).
  ['seven hills to blacktown', 'trip', { from: 'Seven Hills', to: 'Blacktown' }, 'west', 'train', null, 'h'],
  ['quakers hill to schofields', 'trip', { from: 'Quakers Hill', to: 'Schofields' }, 'west', 'train', null, 'h'],
  ['westmead to wentworthville', 'trip', { from: 'Westmead', to: 'Wentworthville' }, 'west', 'train', null, 'h'],
  ['mt druitt to penrith', 'trip', { from: 'Mount Druitt', to: 'Penrith' }, 'west', 'train', null, 'h'],
  ['st marys to central tomorrow at 6am', 'trip', { from: 'St Marys', to: 'Central', time: '06:00', date: '2026-10-27' }, 'west', 'train', null, 'h'],
  ['how do i get to parramatta park', 'trip', { to: 'Parramatta Park' }, 'west', 'any', null, 'h'],
  ['revesby to padstow', 'trip', { from: 'Revesby', to: 'Padstow' }, 'south', 'train', null, 'h'],
  ['engadine to sutherland', 'trip', { from: 'Engadine', to: 'Sutherland' }, 'south', 'train', null, 'h'],
  ['miranda to cronulla by bus', 'trip', { from: 'Miranda', to: 'Cronulla', mode: 'bus' }, 'south', 'bus', null, 'h'],
  ['rockdale to the airport', 'clarify', {}, 'south', 'train', null, 'h'],
  ['ingleburn to minto', 'trip', { from: 'Ingleburn', to: 'Minto' }, 'southwest', 'train', null, 'h'],
  ['casula to liverpool', 'trip', { from: 'Casula', to: 'Liverpool' }, 'southwest', 'train', null, 'h'],
  ['edmondson park to central', 'trip', { from: 'Edmondson Park', to: 'Central' }, 'southwest', 'train', null, 'h'],
  ['bankstown departures', 'departures', { stop: 'Bankstown' }, 'southwest', 'train', null, 'h'],
  ['lakemba to campsie', 'trip', { from: 'Lakemba', to: 'Campsie' }, 'southwest', 'train', null, 'h'],
  ['artarmon to st leonards', 'trip', { from: 'Artarmon', to: 'St Leonards' }, 'north', 'train', null, 'h'],
  ['lindfield to roseville', 'trip', { from: 'Lindfield', to: 'Roseville' }, 'north', 'train', null, 'h'],
  ['wahroonga to turramurra after 5pm', 'trip', { from: 'Wahroonga', to: 'Turramurra', time: '17:00' }, 'north', 'train', null, 'h'],
  ['crows nest to north sydney', 'trip', { from: 'Crows Nest', to: 'North Sydney' }, 'north', 'metro', null, 'h'],
  ['freshwater to manly', 'trip', { from: 'Freshwater', to: 'Manly' }, 'north', 'bus', null, 'h'],
  ['avalon to mona vale', 'trip', { from: 'Avalon', to: 'Mona Vale' }, 'north', 'bus', null, 'h'],
  ['next bus from dee why', 'departures', { stop: 'Dee Why', mode: 'bus' }, 'north', 'bus', null, 'h'],
  ['bella vista to showground', 'trip', { from: 'Bella Vista', to: 'Showground' }, 'hills', 'metro', null, 'h'],
  ['cherrybrook to epping', 'trip', { from: 'Cherrybrook', to: 'Epping' }, 'hills', 'metro', null, 'h'],
  ['parking at bella vista', 'parking', { stop: 'Bella Vista' }, 'hills', 'metro', null, 'h'],
  ['randwick to coogee', 'trip', { from: 'Randwick', to: 'Coogee' }, 'east', 'bus', null, 'h'],
  ['paddington to bondi junction', 'trip', { from: 'Paddington', to: 'Bondi Junction' }, 'east', 'bus', null, 'h'],
  ['double bay to edgecliff', 'trip', { from: 'Double Bay', to: 'Edgecliff' }, 'east', 'any', null, 'h'],
  ['moore park to central light rail', 'trip', { from: 'Moore Park', to: 'Central', mode: 'lightrail' }, 'east', 'lightrail', null, 'h'],
  ['leichhardt to central', 'trip', { from: 'Leichhardt', to: 'Central' }, 'inner', 'any', null, 'h'],
  ['glebe to town hall', 'trip', { from: 'Glebe', to: 'Town Hall' }, 'inner', 'any', null, 'h'],
  ['summer hill to lewisham', 'trip', { from: 'Summer Hill', to: 'Lewisham' }, 'inner', 'train', null, 'h'],
  ['pyrmont to barangaroo', 'trip', { from: 'Pyrmont', to: 'Barangaroo' }, 'cbd', 'any', null, 'h'],
  ['museum to st james', 'trip', { from: 'Museum', to: 'St James' }, 'cbd', 'train', null, 'h'],
  ['wynyard departures after 5:30pm', 'departures', { stop: 'Wynyard', time: '17:30' }, 'cbd', 'train', null, 'h'],
  ['springwood to penrith', 'trip', { from: 'Springwood', to: 'Penrith' }, 'regional', 'train', null, 'h'],
  ['leura to katoomba', 'trip', { from: 'Leura', to: 'Katoomba' }, 'regional', 'train', null, 'h'],
  ['tuggerah to wyong', 'trip', { from: 'Tuggerah', to: 'Wyong' }, 'regional', 'train', null, 'h'],
  ['terrigal to gosford', 'trip', { from: 'Terrigal', to: 'Gosford' }, 'regional', 'bus', null, 'h'],
  ['cardiff to newcastle interchange', 'trip', { from: 'Cardiff', to: 'Newcastle Interchange' }, 'regional', 'train', null, 'h'],
  ['cessnock to maitland', 'trip', { from: 'Cessnock', to: 'Maitland' }, 'regional', 'bus', null, 'h'],
  ['dapto to wollongong', 'trip', { from: 'Dapto', to: 'Wollongong' }, 'regional', 'train', null, 'h'],
  ['mittagong to bowral', 'trip', { from: 'Mittagong', to: 'Bowral' }, 'regional', 'train', null, 'h'],
  ['armidale to tamworth', 'trip', { from: 'Armidale', to: 'Tamworth' }, 'regional', 'coach', null, 'h'],
  ['coffs harbour to grafton', 'trip', { from: 'Coffs Harbour', to: 'Grafton' }, 'regional', 'coach', null, 'h'],
  ['last train to newcastle', 'last', { to: 'Newcastle', mode: 'train' }, 'regional', 'train', null, 'h'],
  ['is the t5 running', 'status', { line: 'T5' }, 'network', 'train', null, 'h'],
  ['how is the t2 going', 'status', { line: 'T2' }, 'network', 'train', null, 'h'],
  ['are there delays on the f1', 'status', { line: 'F1' }, 'north', 'ferry', null, 'h'],
  ['trackwork on the t8 this weekend', 'trackwork', { line: 'T8', when: 'weekend' }, 'network', 'train', null, 'h'],
  ['lifts at wolli creek', 'lift', { stop: 'Wolli Creek' }, 'south', 'train', null, 'h'],
  ['fare from parramatta to manly', 'fare', { from: 'Parramatta', to: 'Manly' }, 'west', 'any', null, 'h'],
  ['when is the next m30 from mosman', 'departures', { line: 'M30', stop: 'Mosman' }, 'north', 'bus', null, 'h'],
  ['next 380 from bondi', 'departures', { line: '380', stop: 'Bondi' }, 'east', 'bus', null, 'h'],
  ['when does the l3 leave kingsford', 'departures', { line: 'L3', stop: 'Kingsford' }, 'east', 'lightrail', null, 'h'],
  ['parramatta to circular quay on the rivercat', 'trip', { from: 'Parramatta', to: 'Circular Quay' }, 'west', 'ferry', null, 'h'],
  ['how do i get to taronga zoo', 'trip', { to: 'Taronga Zoo' }, 'north', 'ferry', null, 'h'],
  ['how do i get to the scg', 'trip', { to: 'SCG' }, 'east', 'bus', null, 'h'],
  ['and the one before', 'earlier', { from: 'Hurstville', to: 'Central' }, 'south', 'train', 'hurstville to central at 8am', 'h'],
  ['what about on the weekend', 'trip', { from: 'Katoomba', to: 'Central', date: '2026-10-31' }, 'regional', 'train', 'katoomba to central', 'h'],
];

const OWNER = /strathf|kings ?(x|cross)|\b410\b|\bd400\b|five dock/i;

function fmt(v) { return typeof v === 'string' ? v : JSON.stringify(v); }
const PLACE_SLOTS = new Set(['from', 'to', 'stop', 'via']);
function slotOk(k, want, got) {
  if (got === undefined || got === null) return false;
  if (PLACE_SLOTS.has(k)) return B.base(String(got)) === B.base(String(want)) || B.base(String(got)).replace(/^sydney /, '') === B.base(String(want));
  return String(got).toLowerCase() === String(want).toLowerCase();
}
export function score(reader) {
  const rows = [];
  for (const [q, intent, slots, region, mode, prev, set] of CORPUS) {
    const r = reader(q, prev);
    const bad = [];
    if (r.intent !== intent) bad.push(`intent ${r.intent}`);
    else for (const [k, v] of Object.entries(slots)) if (!slotOk(k, v, r.slots[k])) bad.push(`${k}=${fmt(r.slots[k])} want ${fmt(v)}`);
    rows.push({ q, region, mode, set: set || 'first', ok: !bad.length, bad });
  }
  const by = (key) => { const m = {}; for (const r of rows) { const g = (m[r[key]] = m[r[key]] || [0, 0]); g[1]++; if (r.ok) g[0]++; } return m; };
  const pass = rows.filter((r) => r.ok).length;
  return { pass, total: rows.length, rate: pass / rows.length, region: by('region'), mode: by('mode'), set: by('set'), fails: rows.filter((r) => !r.ok) };
}
const pct = (a) => `${a[0]}/${a[1]} (${Math.round((a[0] / a[1]) * 100)}%)`;

// The new reader: askBrain with the previous question as context.
function brainRead(q, prev) {
  let last = null;
  if (prev) { const u0 = B.understand(prev, CTX); last = B.nextLast(u0, {}, NOW); }
  return B.understand(q, { ...CTX, last });
}

// The old path, for the before number: the server's rules (worker.js askRoute, answer()) in their order,
// with the question as typed and exact names only (no typo matching, no follow ups, no day words).
function legacyRead(q) {
  const s = { };
  const text = q.replace(/^(hey|hi|ok|okay|so|um|please)[,\s]+/i, '').replace(/\s*(please|pls|plz|thanks|thank you|mate)[.!?]*$/i, '').replace(/[?!.]+$/, '').replace(/\s+/g, ' ').trim();
  const lower = text.toLowerCase();
  const exact = (p) => { if (!p) return undefined; const k = B.base(p.replace(/^(the|next)\s+/i, '').replace(/\s+(by|on|using)\s+(the\s+)?(trains?|bus(es)?|metro|ferr(y|ies)|light rail)$/i, '')); const e = gaz.keys.get(k); return e ? e.name : p; };
  const done = (intent) => ({ intent, slots: s });
  if (!text) return done('help');
  if (/^(thanks|thank you|cheers|ta|thx)$/i.test(lower)) return done('thanks');
  const fare = /\b(fares?|how much|costs?|price)\b/i.test(text) && /\s(to|>|->)\s/i.test(text);
  if (fare) { const m = text.match(/(?:from\s+)?(\S.*?)\s+to\s+(.+)$/i); if (m) { s.from = exact(m[1].replace(/^.*\b(fare|from|cost|price|much)\s+/i, '')); s.to = exact(m[2]); } return done('fare'); }
  if (/\b(park|parking|car ?park|park and ride|spaces)\b/i.test(text)) { s.stop = exact(text.replace(/^.*\b(at|in)\s+/i, '').replace(/\s+station$/i, '')); return done('parking'); }
  if (/\b(lifts?|escalators?|step free|wheelchair|accessible)\b/i.test(text)) { s.stop = exact(text.replace(/^.*\b(at|in)\s+/i, '')); return done('lift'); }
  const lm = lower.match(/^(?:when(?:'s| is)\s+|what time is\s+)?(?:the\s+)?last\s+(train|bus|metro|ferry|light rail|service|one)?\s*(.*)$/i);
  if (lm) { const mo = { train: 'train', bus: 'bus', metro: 'metro', ferry: 'ferry', 'light rail': 'lightrail' }[lm[1]]; if (mo) s.mode = mo; const rest = lm[2].replace(/\b(tonight|today)\b/g, '').trim(); const ft = rest.match(/^(?:from\s+)?(.+?)\s+to\s+(.+)$/); if (ft) { s.from = exact(ft[1]); s.to = exact(ft[2]); } else s.to = exact(rest.replace(/^to\s+/, '')) || 'home'; return done('last'); }
  let tripText = text.replace(/^(?:(?:when(?:'s| is)|what(?:'s| is))\s+)?(?:the\s+(?=(?:next|first|earliest|fastest|train|bus|metro|ferry|light rail|tram|service|trip|way)\b))?(?:next|first|earliest|fastest)?\s*(?:train|bus|metro|ferry|light rail|tram|service|trip|way)?\s*(?:from\s+)?/i, '');
  const tv = tripText.match(/^(?:how (?:do|can|would|should) i (?:get|go|travel)|how to (?:get|go)|how (?:long|far) (?:is it|does it take)(?: to get)?|get me|take me|directions|route|i (?:need|want|have|got) to (?:get|go|travel|head)|i(?:'m| am) (?:going|heading)|going|heading|get)\b\s*/i);
  if (tv && tv[0].trim()) tripText = tripText.slice(tv[0].length);
  const mo = text.match(/\b(trains?|metro|bus(es)?|ferr(y|ies)|light rail)\b/i);
  const mode = mo ? { train: 'train', trains: 'train', metro: 'metro', bus: 'bus', buses: 'bus', ferry: 'ferry', ferries: 'ferry', 'light rail': 'lightrail' }[mo[1].toLowerCase()] : undefined;
  const tm = tripText.match(/\b(at|by|after|before)\s+(\d{1,2})(?::|\.)?(\d{2})?\s*(am|pm)?\b/i);
  if (tm) { let h = +tm[2]; const ap = (tm[4] || '').toLowerCase(); if (ap === 'pm' && h < 12) h += 12; if (!ap && h < 7) h += 12; s.time = `${String(h).padStart(2, '0')}:${tm[3] || '00'}`; if (/^(by|before)$/i.test(tm[1])) s.arriveBy = true; tripText = tripText.replace(tm[0], ' ').replace(/\s+/g, ' ').trim(); }
  const LINE = /\b(T[1-9]|M1|L[1-4]|F[1-9]\d?|BMT|CCN|SCO|HUN|SHL|BNT|[0-9]{3}[A-Z]?|[A-Z][0-9]{2,3}[A-Z]?)\b/i;
  const lineQ = /^(is|are|any|hows?|how's)\b/i.test(text) && LINE.test(text);
  const m = lineQ ? null : tripText.match(/^(?:from\s+)?(.+?)\s+to\s+(.+)$/i) || tripText.match(/^to\s+(.+?)\s+from\s+(.+)$/i);
  if (m) { const [a, b] = /^to\s/i.test(tripText) ? [m[2], m[1]] : [m[1], m[2]]; s.from = exact(a); s.to = exact(b); if (mode) s.mode = mode; return done('trip'); }
  const only = tripText.match(/^to\s+(.+)$/i);
  if (only && (tv || tripText !== text)) { s.to = exact(only[1]); if (mode) s.mode = mode; return done('trip'); }
  if (/^(alerts?|status|service alerts?|disruptions?|trackwork)\b/i.test(lower)) return done('trackwork');
  if (/^(near me|nearby|stops near me|closest stop|nearest stop)$/i.test(lower)) return done('nearby');
  const lineM = text.match(LINE);
  if (lineM) {
    const line = lineM[1].toUpperCase(); s.line = line;
    const isStatus = /\b(late|delay(s|ed)?|running|on time|status|ok(ay)?|working|problems?|issues?|trackwork|disruptions?|alerts?|slow|cancel+ed|how'?s|how is)\b/i.test(text);
    const placePart = text.replace(lineM[0], ' ').replace(/\b(is|are|the|a|an|when'?s|when|what'?s|whats|what time|next|line|route|bus|buses|train|trains|from|at|running|late|delays?|status|ok|any|how|today|now|leave|does)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    if (isStatus) return done('status');
    if (placePart) s.stop = exact(placePart);
    return done('departures');
  }
  let p = text.replace(/^(when'?s|when is|what'?s)\s+(the\s+)?/i, '').replace(/^(next|upcoming)\s+/i, '').replace(/^(trains?|metro|light ?rail|buses|bus|ferry|ferries|services?|departures?)\s*/i, '').replace(/^(from|at|for)\s+/i, '');
  if (mode) s.mode = mode;
  const k = B.base(p);
  if (gaz.keys.has(k)) { s.stop = gaz.keys.get(k).name; return done('departures'); }
  return done(p.length > 2 ? 'departures' : 'help');
}

test('corpus has at least 200 questions across Sydney and NSW, few on one commute', () => {
  assert.ok(CORPUS.length >= 200, `only ${CORPUS.length}`);
  const own = CORPUS.filter((r) => OWNER.test(r[0]) || OWNER.test(JSON.stringify(r[2])));
  assert.ok(own.length / CORPUS.length <= 0.05, `${own.length} questions name one commute`);
  const regions = new Set(CORPUS.map((r) => r[3]));
  for (const r of ['cbd', 'inner', 'east', 'north', 'west', 'southwest', 'south', 'hills', 'regional']) assert.ok(regions.has(r), r);
  const modes = new Set(CORPUS.map((r) => r[4]));
  for (const m of ['train', 'metro', 'lightrail', 'ferry', 'bus', 'coach']) assert.ok(modes.has(m), m);
});

test('the Ask engine reads 90% or more of the corpus (before: the old path)', () => {
  const before = score((q) => legacyRead(q));
  const after = score(brainRead);
  const lines = [`Ask corpus: ${after.total} questions`, `before ${before.pass}/${before.total} (${Math.round(before.rate * 100)}%), after ${after.pass}/${after.total} (${Math.round(after.rate * 100)}%)`];
  lines.push('by batch (after):   ' + Object.entries(after.set).map(([k, v]) => `${k === 'h' ? 'second batch' : 'first batch'} ${pct(v)}`).join(', '));
  lines.push('by region (after):  ' + Object.entries(after.region).map(([k, v]) => `${k} ${pct(v)}`).join(', '));
  lines.push('by mode (after):    ' + Object.entries(after.mode).map(([k, v]) => `${k} ${pct(v)}`).join(', '));
  lines.push('by region (before): ' + Object.entries(before.region).map(([k, v]) => `${k} ${pct(v)}`).join(', '));
  lines.push('by mode (before):   ' + Object.entries(before.mode).map(([k, v]) => `${k} ${pct(v)}`).join(', '));
  for (const f of after.fails) lines.push(`  miss: "${f.q}": ${f.bad.join('; ')}`);
  console.log(lines.join('\n'));
  if (process.env.ASK_CORPUS_JSON) fs.writeFileSync(process.env.ASK_CORPUS_JSON, JSON.stringify({ before, after }, null, 1));
  assert.ok(after.rate >= 0.9, `pass rate ${Math.round(after.rate * 100)}%`);
});
