import { useState } from 'react';
import GuestApp from './guest/GuestApp';
import WaiterApp from './waiter/WaiterApp';
import AdminPanel from './admin/AdminPanel';
import ConstructorApp from './constructor/ConstructorApp';

export default function App(){
const [mode,setMode]=useState<'guest'|'waiter'|'admin'|'constructor'>('guest');
return <main className="min-h-screen bg-[#10100f] text-white">
<div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 gap-2 rounded-2xl border border-neutral-800 bg-neutral-950/95 p-2 shadow-2xl">
{(['guest','waiter','admin','constructor'] as const).map(m=><button key={m} onClick={()=>setMode(m)} className={rounded-xl px-3 py-2 text-xs ${mode===m?'bg-amber-300 text-neutral-950':'bg-neutral-800'}}>{m==='guest'?'Гість':m==='waiter'?'Офіціант':m==='admin'?'Адмін':'Конструктор'}</button>)}
</div>
{mode==='guest'&&<GuestApp/>}{mode==='waiter'&&<WaiterApp/>}{mode==='admin'&&<AdminPanel/>}{mode==='constructor'&&<ConstructorApp/>}

  </main>  
}
