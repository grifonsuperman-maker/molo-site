const { SyrveStatusReadService } = require('../../dist/syrve/syrve-status-read.service.js');
const { TableStatusProjectionService } = require('../../dist/tables/table-status-projection.service.js');

function disabledSource() {
  return { options: { type: 'postgres' }, transaction: async (_isolation, action) => action({query:async sql=>{
    if(sql.startsWith('SET '))return [];
    if(sql.includes('to_regclass'))return [{prepared:false}];
    throw new Error('Unprepared status reads must not query feature records');
  }}) };
}
function disabledTableStatuses() {
  const source = disabledSource();
  return new TableStatusProjectionService(new SyrveStatusReadService(source));
}
module.exports = { disabledTableStatuses, disabledSource };
