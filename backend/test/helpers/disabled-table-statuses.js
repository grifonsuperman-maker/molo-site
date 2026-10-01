const { SyrveStatusReadService } = require('../../dist/syrve/syrve-status-read.service.js');
const { TableStatusProjectionService } = require('../../dist/tables/table-status-projection.service.js');

function disabledTableStatuses() {
  const source = { options: { type: 'postgres' }, transaction: async () => {
    throw new Error('Disabled status reads must not query Syrve storage');
  } };
  return new TableStatusProjectionService(new SyrveStatusReadService(source));
}
module.exports = { disabledTableStatuses };
