require("reflect-metadata");

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  HookahCallsService,
} = require("../dist/hookah-calls/hookah-calls.service.js");

function createCall(status = "new") {
  return {
    id: "call-1",
    booking: {
      id: "booking-1",
      client: { fullName: "Гість" },
    },
    table: {
      id: "table-1",
      tableNumber: "8",
      zone: { name: "Зал ресторану" },
    },
    acceptedByStaff: null,
    status,
    etaMinutes: null,
    etaDueAt: null,
    waiterName: null,
    createdAt: new Date(),
    acceptedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
  };
}

function createAcceptService({ call, onSave = async (value) => value }) {
  const worker = {
    id: "hookah-1",
    fullName: "Кальянник 1",
    role: "hookah",
    active: true,
    isArchived: false,
    isOnShift: true,
  };
  const lockCalls = [];
  const callFindCalls = [];
  const queryBuilder = {
    where() {
      return this;
    },
    setLock(...args) {
      lockCalls.push(args);
      return this;
    },
    async getOne() {
      return { id: call.id };
    },
  };
  const callRepo = {
    createQueryBuilder: () => queryBuilder,
    findOne: async (options) => {
      callFindCalls.push(options);
      return call;
    },
    save: onSave,
  };
  const staffRepo = {
    findOne: async () => worker,
  };
  const repositories = {
    HookahCall: callRepo,
    Staff: staffRepo,
  };
  const dataSource = {
    transaction: async (work) =>
      work({
        getRepository: (entity) => repositories[entity.name],
      }),
  };
  const service = new HookahCallsService(
    callRepo,
    {},
    staffRepo,
    {},
    {},
    dataSource,
  );

  return { service, worker, lockCalls, callFindCalls };
}

test("hookah accept locks only the call row before loading nullable relations", async () => {
  const call = createCall();
  const { service, worker, lockCalls, callFindCalls } = createAcceptService({
    call,
  });

  const result = await service.accept(call.id, worker.id, { etaMinutes: 10 });

  assert.equal(result.message, "Виклик прийнято");
  assert.equal(result.call.acceptedByStaffId, worker.id);
  assert.deepEqual(lockCalls, [
    ["pessimistic_write", undefined, ["hookah_call"]],
  ]);
  assert.ok(callFindCalls.length >= 1);
  assert.equal("lock" in callFindCalls[0], false);
  assert.deepEqual(callFindCalls[0].relations, {
    booking: { client: true },
    table: { zone: true },
    acceptedByStaff: true,
  });
});

test("hookah accept rejects the second worker after the locked call is reread", async () => {
  const call = createCall("accepted");
  call.acceptedByStaff = {
    id: "hookah-first",
    fullName: "Кальянник 1",
  };
  let saveCalled = false;
  const { service, lockCalls } = createAcceptService({
    call,
    onSave: async (value) => {
      saveCalled = true;
      return value;
    },
  });

  await assert.rejects(
    () => service.accept(call.id, "hookah-second", { etaMinutes: 5 }),
    (error) => {
      assert.equal(error.message, "Цей виклик уже прийняв інший кальянник");
      return true;
    },
  );

  assert.deepEqual(lockCalls, [
    ["pessimistic_write", undefined, ["hookah_call"]],
  ]);
  assert.equal(saveCalled, false);
});
