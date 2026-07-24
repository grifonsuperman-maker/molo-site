from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


waiter_path = Path("frontend/src/waiter/WaiterApp.tsx")
waiter = waiter_path.read_text(encoding="utf-8")

waiter = replace_once(
    waiter,
    '''import {
  waiterCallsApi,
  type WaiterAssignment,
  type WaiterCall,
} from "../api/waiterCalls";''',
    '''import {
  waiterCallsApi,
  type WaiterCall,
} from "../api/waiterCalls";''',
    "remove WaiterAssignment import",
)

waiter = replace_once(
    waiter,
    '  const [assignments, setAssignments] = useState<WaiterAssignment[]>([]);\n',
    '',
    "remove assignments state",
)

waiter = replace_once(
    waiter,
    '''      const [b, c, a] = await Promise.all([
        bookingsApi.getToday(),
        waiterCallsApi.list(),
        waiterCallsApi.assignments(),
      ]);
      setBookings(b);
      setCalls(c);
      setAssignments(a);''',
    '''      const [b, c] = await Promise.all([
        bookingsApi.getToday(),
        waiterCallsApi.list(),
      ]);
      setBookings(b);
      setCalls(c);''',
    "load database-backed waiter assignment",
)

waiter = replace_once(
    waiter,
    '''  const mine = useMemo(() => {
    const ids = new Set(
      assignments
        .filter((a) => a.waiterId === staff?.id)
        .map((a) => a.bookingId),
    );
    return active.filter((b) => ids.has(b.id));
  }, [active, assignments, staff]);''',
    '''  const mine = useMemo(
    () => active.filter((booking) => booking.assignedWaiterId === staff?.id),
    [active, staff?.id],
  );
  const transferGroups = useMemo(() => {
    const groups = new Map<string, TableItem[]>();
    for (const table of tables) {
      const location = table.zone?.name?.trim() || "Без локації";
      const items = groups.get(location) || [];
      items.push(table);
      groups.set(location, items);
    }

    return [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right, "uk"))
      .map(([location, items]) => ({
        location,
        tables: [...items].sort((left, right) => {
          const leftNumber = Number(left.tableNumber);
          const rightNumber = Number(right.tableNumber);
          if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
            return leftNumber - rightNumber;
          }
          return String(left.tableNumber).localeCompare(String(right.tableNumber), "uk");
        }),
      }));
  }, [tables]);''',
    "use durable assignments and location groups",
)

waiter = replace_once(
    waiter,
    '''                            () =>
                              bookingsApi
                                .checkIn(b.id)
                                .then(() =>
                                  waiterCallsApi.assign({
                                    bookingId: b.id,
                                    tableId: b.table?.id,
                                    tableNumber: b.table?.tableNumber,
                                  }),
                                ),''',
    '''                            () =>
                              bookingsApi.checkIn(b.id).then(async () => {
                                try {
                                  await waiterCallsApi.assign({
                                    bookingId: b.id,
                                    tableId: b.table?.id,
                                    tableNumber: b.table?.tableNumber,
                                  });
                                } catch {
                                  // Check-in is stored in booking history, so "Мої столи" remains correct.
                                }
                              }),''',
    "make in-memory assignment best effort",
)

waiter = replace_once(
    waiter,
    '''                        {loc(Number(b.table?.tableNumber || 0))} ·{" "}
                        {b.guestsCount} гостей''',
    '''                        {b.table?.zone?.name || loc(Number(b.table?.tableNumber || 0))} ·{" "}
                        {b.guestsCount} гостей''',
    "show real booking location",
)

waiter = replace_once(
    waiter,
    '''              <div className="mt-4 grid grid-cols-2 gap-2">
                {tables.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      if (
                        confirm(
                          `Пересадити гостей зі столу №${transfer.table?.tableNumber} на стіл №${t.tableNumber}?`,
                        )
                      )
                        act(`t${transfer.id}`, () =>
                          bookingsApi
                            .waiterTransfer(transfer.id, t.id)
                            .then(() => setTransfer(null)),
                        );
                    }}
                    className="rounded-2xl border border-white/20 bg-black/30 p-4 text-left active:scale-95"
                  >
                    <b>Стіл №{t.tableNumber}</b>
                    <span className="block text-sm text-white/55">
                      {loc(Number(t.tableNumber))}
                    </span>
                  </button>
                ))}
              </div>''',
    '''              <div className="mt-4 space-y-5">
                {transferGroups.length ? (
                  transferGroups.map((group) => (
                    <section key={group.location}>
                      <h3 className="mb-2 text-sm font-black uppercase tracking-[.16em] text-amber-100/75">
                        {group.location}
                      </h3>
                      <div className="grid grid-cols-2 gap-2">
                        {group.tables.map((t) => (
                          <button
                            key={t.id}
                            onClick={() => {
                              if (
                                confirm(
                                  `Пересадити гостей зі столу №${transfer.table?.tableNumber} на стіл №${t.tableNumber}?`,
                                )
                              )
                                act(`t${transfer.id}`, () =>
                                  bookingsApi
                                    .waiterTransfer(transfer.id, t.id)
                                    .then(() => setTransfer(null)),
                                );
                            }}
                            className="rounded-2xl border border-white/20 bg-black/30 p-4 text-left active:scale-95"
                          >
                            <b>Стіл №{t.tableNumber}</b>
                            <span className="block text-sm text-white/55">
                              до {t.seats} місць
                            </span>
                          </button>
                        ))}
                      </div>
                    </section>
                  ))
                ) : (
                  <p className="text-white/60">Вільних столів немає.</p>
                )}
              </div>''',
    "group transfer tables by real location",
)

waiter_path.write_text(waiter, encoding="utf-8")

controller_path = Path("backend/src/bookings/bookings.controller.ts")
controller = controller_path.read_text(encoding="utf-8")
controller = replace_once(
    controller,
    "  @Roles('admin', 'owner')\n  waiterTransfer",
    "  @Roles('waiter', 'admin', 'owner')\n  waiterTransfer",
    "allow waiter transfer",
)
controller_path.write_text(controller, encoding="utf-8")
