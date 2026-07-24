import CompactDirectorPanel from './CompactDirectorPanel';
import DirectorAuthGate from './DirectorAuthGate';
import SyrveIntegrationDock from './SyrveIntegrationDock';

export default function DirectorWorkspace() {
  return (
    <DirectorAuthGate>
      <CompactDirectorPanel />
      <SyrveIntegrationDock />
    </DirectorAuthGate>
  );
}
