import DirectorAccessSettingsDock from './DirectorAccessSettingsDock';
import DirectorAuthGate from './DirectorAuthGate';
import DirectorReviewArchiveDock from './DirectorReviewArchiveDock';
import DirectorSiteControlsDock from './DirectorSiteControlsDock';
import DirectorStaffActionsArchiveDock from './DirectorStaffActionsArchiveDock';
import PremiumDirectorPanel from './PremiumDirectorPanel';
import SyrveIntegrationDock from './SyrveIntegrationDock';

export default function DirectorWorkspace() {
  return (
    <DirectorAuthGate>
      <PremiumDirectorPanel />
      <DirectorReviewArchiveDock />
      <DirectorStaffActionsArchiveDock />
      <DirectorSiteControlsDock />
      <DirectorAccessSettingsDock />
      <SyrveIntegrationDock />
    </DirectorAuthGate>
  );
}
