const {SyrveClient}=require('../../dist/syrve/syrve-client.js');
const {activationBindings}=require('../../dist/syrve/syrve-activation.js');
const {id}=require('./syrve-state-fixtures.js');
function consent(h) {
  h.mutate(db => { db.activation = {enabled:true,configuration_revision:h.entity.configurationRevision,actor_hash:'a'.repeat(64),consented_at:new Date(),
    bindings_fingerprint:activationBindings(h.snapshot(),[db.physical]),loading_plan:{organizationId:h.entity.organizationId,
      groups:[{terminalGroupId:id(1),posVersion:'7.7.1',tableIds:[db.link.syrve_table_id]}]}}; });
}
async function confirmed(capture, ids, controls, response) {
  // Only this injected transport is fake. The production private receipt issuer,
  // scope checks and guards run unchanged; the helper cannot set visibility itself.
  const value=await response(capture,ids,controls),client=new SyrveClient();
  client.probeOrders=async()=>value;
  client.initializeTables=async(base,login,plan,options)=>options.beforeCommand();
  return client.probeLoadedOrders('https://api-eu.syrve.live','synthetic-fixture',capture.state.scope.organizationId,
    [capture.state.scope.syrveTableId],ids,controls);
}
async function consentDatabase(source,settings) {
  const snapshot=await settings.read(),entity=snapshot.entity;
  const tables=await source.query('SELECT id,table_number AS "tableNumber" FROM tables');
  const plan={organizationId:entity.organizationId,groups:[{terminalGroupId:id(1),posVersion:'7.7.1',tableIds:snapshot.links.map(link=>link.syrveTableId).sort()}]};
  await source.query('INSERT INTO syrve_sync_activation(integration_id,configuration_revision,enabled,bindings_fingerprint,loading_plan,actor_hash,consented_at)'
    + ' VALUES ($1,$2,true,$3,$4::jsonb,$5,clock_timestamp()) ON CONFLICT(integration_id) DO UPDATE SET configuration_revision=EXCLUDED.configuration_revision,'
    + ' enabled=true,bindings_fingerprint=EXCLUDED.bindings_fingerprint,loading_plan=EXCLUDED.loading_plan',
  [entity.id,entity.configurationRevision,activationBindings(snapshot,tables),JSON.stringify(plan),'a'.repeat(64)]);
}
module.exports={consent,confirmed,consentDatabase};
