import DirectorAccessSettingsDock from './DirectorAccessSettingsDock';
import DirectorAuthGate from './DirectorAuthGate';
import PremiumDirectorPanel from './PremiumDirectorPanel';
import SyrveIntegrationDock from './SyrveIntegrationDock';

export default function DirectorWorkspace() {
  return (
    <DirectorAuthGate>
      <PremiumDirectorPanel />
      <DirectorAccessSettingsDock />
      <SyrveIntegrationDock />
    </DirectorAuthGate>
  );
}
