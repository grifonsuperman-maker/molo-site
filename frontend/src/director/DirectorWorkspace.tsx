import DirectorAccessSettingsDock from './DirectorAccessSettingsDock';
import DirectorAuthGate from './DirectorAuthGate';
import PremiumDirectorPanel from './PremiumDirectorPanel';
import DirectorTeamManagementDock from './DirectorTeamManagementDock';
import SyrveIntegrationDock from './SyrveIntegrationDock';

export default function DirectorWorkspace() {
  return (
    <DirectorAuthGate>
      <PremiumDirectorPanel />
      <DirectorTeamManagementDock />
      <DirectorAccessSettingsDock />
      <SyrveIntegrationDock />
    </DirectorAuthGate>
  );
}
