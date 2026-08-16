import DirectorAccessSettingsDock from './DirectorAccessSettingsDock';
import DirectorAuthGate from './DirectorAuthGate';
import DirectorSiteControlsDock from './DirectorSiteControlsDock';
import PremiumDirectorPanel from './PremiumDirectorPanel';
import SyrveIntegrationDock from './SyrveIntegrationDock';

export default function DirectorWorkspace() {
  return (
    <DirectorAuthGate>
      <PremiumDirectorPanel />
      <DirectorSiteControlsDock />
      <DirectorAccessSettingsDock />
      <SyrveIntegrationDock />
    </DirectorAuthGate>
  );
}
