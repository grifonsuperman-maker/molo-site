// Offline audit probes. Uses synthetic repositories and no network or real DB.
// Exit 1 means one or more intended safety properties failed; this is not npm test.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const fromBackend = createRequire(path.join(root, 'backend/package.json'));
fromBackend('reflect-metadata');
const { BookingsService } = fromBackend('./dist/bookings/bookings.service.js');
const { NotificationsService } = fromBackend('./dist/notifications/notifications.service.js');
const { CreateBookingDto } = fromBackend('./dist/bookings/dto/create-booking.dto.js');
const { plainToInstance } = fromBackend('class-transformer');
const { validate } = fromBackend('class-validator');

const results = [];
function record(id, expected, actual, passed) { results.push({ id, expected, actual, passed }); }
const today = new Intl.DateTimeFormat('en-CA', { timeZone:'Europe/Kyiv', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
const tableId = '00000000-0000-4000-8000-000000000101';
function fixture({ failHistory = false } = {}) {
  const table = { id:tableId, tableNumber:'1', seats:4, status:'free', isVisible:true, zone:{ id:'zone-1', isVisible:true, isClosed:false } };
  const client = { id:'client-1', fullName:'Тестовий Гість', phone:'+380501234567', isBlacklisted:false, visitsCount:0, totalGuests:0, lastVisitAt:null };
  const rows = [];
  const histories = [];
  const qb = () => {
    const params = {};
    const chain = {};
    for (const method of ['leftJoinAndSelect','addSelect','orderBy','where','andWhere']) {
      chain[method] = (_expression, value) => { if(value && typeof value === 'object') Object.assign(params,value); return chain; };
    }
    chain.getMany = async () => rows.filter(b =>
      (!params.bookingDate || b.bookingDate === params.bookingDate) &&
      (!params.tableId || b.table.id === params.tableId) &&
      (!params.statuses || params.statuses.includes(b.status)) &&
      (!params.excludeBookingId || b.id !== params.excludeBookingId));
    return chain;
  };
  const bookings = {
    createQueryBuilder:qb,
    create: value => ({ id:`synthetic-booking-${rows.length + 1}`, createdAt:new Date(), ...value }),
    findOne: async ({where}) => rows.find(b=>b.id===where.id) || null,
    save: async value => { if(!rows.includes(value)) rows.push(value); return value; },
  };
  const historyRepo = { create:v=>v, save:async v=>{if(failHistory) throw new Error('AUDIT_INJECTED_HISTORY_FAILURE');histories.push(v);return v;} };
  const clients = { findOne:async()=>client, create:v=>v, save:async v=>v };
  const tables = { findOne:async()=>table, save:async v=>v };
  const restaurants = { find:async()=>[{status:'open',phone:null,openTime:'10:00',closeTime:'23:00'}] };
  const notifications = new Proxy({}, {get:()=>async()=>undefined});
  const service = new BookingsService(bookings,historyRepo,{},clients,tables,restaurants,{create:async()=>{}},notifications,{});
  const payload = {
    tableId, tableNumber:'1',fullName:'Тестовий Гість',phone:client.phone,
    guestDeviceId:'synthetic-device-only',bookingDate:today,bookingTime:'19:00',durationMinutes:120,guestsCount:2,wishes:'',
  };
  return {service, rows, table, client, payload, histories};
}

async function main() {
  {
    const f=fixture();
    const old={id:'cancelled-old',table:f.table,client:f.client,status:'cancelled',bookingDate:today,bookingTime:'19:00',durationMinutes:120,guestsCount:2,cancelledAt:new Date()};
    const current={id:'approved-current',table:f.table,client:{...f.client,id:'client-2',phone:'+380671234567'},status:'approved',bookingDate:today,bookingTime:'19:00',durationMinutes:120,guestsCount:2};
    f.rows.push(old,current);
    await f.service.approve(old.id);
    const active=f.rows.filter(b=>['pending','approved'].includes(b.status)).length;
    record('AUD-01','Old cancelled booking cannot be approved over a replacement booking',{oldStatus:old.status,activeOverlappingBookings:active},old.status==='cancelled'&&active===1);
  }
  {
    const f=fixture({failHistory:true});let error;
    const original=console.error;console.error=()=>{};
    try {await f.service.create(f.payload);}catch(e){error=e.message;}finally{console.error=original;}
    record('AUD-02','Failed creation leaves no active booking and no raw internal error',{savedActiveBookings:f.rows.length,error,tokenReturned:false},f.rows.length===0&&!String(error).includes('AUDIT_INJECTED_HISTORY_FAILURE'));
  }
  for(const [id,override,expected] of [
    ['AUD-03a',{bookingDate:'2020-01-02'},'Guest booking in the past is rejected by server'],
    ['AUD-03b',{bookingTime:'03:00'},'Guest booking outside configured 10:00–23:00 hours is rejected'],
    ['AUD-03c',{guestsCount:100},'100 guests cannot silently book a four-seat table'],
  ]) {
    const f=fixture();const dto=plainToInstance(CreateBookingDto,{...f.payload,...override});
    const errors=await validate(dto);let result,exception;
    if(!errors.length){try{result=await f.service.create(dto);}catch(e){exception=e.message;}}
    record(id,expected,{dtoErrors:errors.map(e=>e.property),created:!!result,...override,exception},errors.length>0||!!exception);
  }
  {
    const f=fixture();await f.service.create({...f.payload,fullName:'Нове Імя'});
    // Service probe deliberately supplies a different name directly; no network.
    record('AUD-04','Booking keeps the newly entered guest name',{storedGuestName:f.rows[0].guestName,linkedClientName:f.rows[0].client.fullName},f.rows[0].guestName==='Нове Імя'||f.rows[0].client.fullName==='Нове Імя');
  }
  {
    const sent=[];
    const service=new NotificationsService({find:async()=>[{telegramId:'synthetic-chat',role:'admin'}]},{sendMessage:async(...args)=>{sent.push(args);return {ok:true};}});
    const wishes='Місце <біля вікна> & без протягу';
    await service.notifyNewBooking({id:'synthetic-booking',table:{tableNumber:'1'},client:{fullName:'Тест',phone:'+380501234567'},bookingDate:today,bookingTime:'19:00',durationMinutes:120,guestsCount:2,wishes});
    const containsRawMarkup=sent.some(([,text])=>text.includes('<біля вікна>'));
    record('AUD-05','Free-text wishes are escaped in HTML Telegram messages',{containsRawMarkup,messageCount:sent.length},!containsRawMarkup);
  }
  {
    const ts=fromBackend('typescript');
    const source=fs.readFileSync(path.join(root,'frontend/src/api/client.ts'),'utf8').replace('import.meta.env.VITE_API_URL',"'http://audit.invalid/api'");
    const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
    const denied=()=>{const e=new Error('Storage disabled');e.name='SecurityError';throw e;};
    const sandbox={exports:{},localStorage:{getItem:denied,setItem:denied,removeItem:denied}};
    vm.runInNewContext(output,sandbox);
    const failed=[];
    for(const name of ['setAccessToken','clearAccessToken']){try{sandbox.exports[name]('synthetic-token');}catch(e){failed.push({method:name,error:e.name});}}
    record('AUD-06','Storage denial does not throw from token write/clear helpers',failed,failed.length===0);
  }
  {
    const f=fixture();
    f.rows.push({id:'checked-in',table:f.table,client:f.client,status:'approved',bookingDate:today,bookingTime:'19:00',durationMinutes:120,guestsCount:2,checkedInAt:new Date()});
    await f.service.complete('checked-in',{role:'admin',staffId:'synthetic-admin'});
    record('AUD-07','Completed checked-in visit updates statistics used by regular-client and recent-visit queries',{visitsCount:f.client.visitsCount,totalGuests:f.client.totalGuests,lastVisitAt:f.client.lastVisitAt},f.client.visitsCount===1&&f.client.totalGuests===2&&!!f.client.lastVisitAt);
  }
  {
    const ts=fromBackend('typescript');
    const source=fs.readFileSync(path.join(root,'frontend/src/guest/GuestApp.tsx'),'utf8');
    const ast=ts.createSourceFile('GuestApp.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const guest=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='GuestApp');
    const functions=guest.body.statements.filter(n=>ts.isFunctionDeclaration(n)&&['refreshMap','refreshDateStatuses'].includes(n.name?.text)).map(n=>n.getText(ast)).join('\n');
    const statement=guest.body.statements.find(n=>ts.isExpressionStatement(n)&&ts.isCallExpression(n.expression)&&n.expression.expression.getText(ast)==='useEffect'&&n.expression.arguments[0].getText(ast).includes('function refreshPublicSettings'));
    const effect=statement.expression.arguments[0].getText(ast);
    const deps=statement.expression.arguments[1].getText(ast);
    const body=`const {date,time,durationMinutes,window,mapApi,restaurantApi,bookingsApi,setMap,setDateStatuses,setRestaurant,getMapFromResponse,getRestaurantFromResponse}=context;\n${functions}\nconst audit={setup:${effect},refreshDateStatuses};`;
    const output=ts.transpileModule(body,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
    const render=new Function('context',output+'\nreturn audit;');
    const requests=[];let tick;
    const shared={time:'19:00',durationMinutes:120,window:{setInterval:(f)=>{tick=f;return 1;},clearInterval:()=>{}},mapApi:{get:async()=>null},restaurantApi:{get:async()=>null},bookingsApi:{tableStatuses:async p=>{requests.push(p);return {statuses:{}};}},setMap:()=>{},setDateStatuses:()=>{},setRestaurant:()=>{},getMapFromResponse:x=>x,getRestaurantFromResponse:x=>x};
    render({...shared,date:'2026-09-13'}).setup();
    const next=render({...shared,date:'2026-09-14'});
    if(deps!=='[]')throw new Error('Polling probe needs adapting: effect dependencies changed');
    next.refreshDateStatuses();tick();await Promise.resolve();
    record('AUD-08','15-second timer reads the currently selected booking date',{effectDependencies:deps,selectedDate:'2026-09-14',requestedDates:requests.map(r=>r.bookingDate)},requests.at(-1).bookingDate==='2026-09-14');
  }
  console.log(JSON.stringify({mode:'offline service probes; synthetic repositories; no production writes; no PostgreSQL concurrency claim',results,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length},null,2));
  process.exitCode=results.some(r=>!r.passed)?1:0;
}
main().catch(error=>{console.error(error);process.exitCode=2;});
