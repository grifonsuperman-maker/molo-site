import CompactDirectorPanel from './CompactDirectorPanel';
import DirectorAccessSettingsDock from './DirectorAccessSettingsDock';
import DirectorAuthGate from './DirectorAuthGate';
import SyrveIntegrationDock from './SyrveIntegrationDock';

export default function DirectorWorkspace() {
  return (
    <DirectorAuthGate>
      <CompactDirectorPanel />
      <DirectorAccessSettingsDock />
      <SyrveIntegrationDock />
    </DirectorAuthGate>
  );
}
