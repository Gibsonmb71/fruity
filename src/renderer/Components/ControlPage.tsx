import { ControlPages } from '../Enums';
import { INavigationIntent } from '../Services/Navigation';
import RoomsPage from './Rooms/RoomsPage';

interface IControlPageProps {
  section: ControlPages;
  onSectionChange: (section: ControlPages) => void;
  onNavigateTarget: (intent: INavigationIntent) => void;
  // eslint-disable-next-line react/require-default-props
  navigation?: INavigationIntent;
  // eslint-disable-next-line react/require-default-props
  onNavigationHandled: () => void;
}

/** The tournament-day operations area. RoomsPage owns the existing server workflows and dialogs. */
export default function ControlPage({
  section,
  onSectionChange,
  onNavigateTarget,
  navigation,
  onNavigationHandled,
}: IControlPageProps) {
  return (
    <RoomsPage
      activeTab={section}
      onTabChange={onSectionChange}
      onNavigateTarget={onNavigateTarget}
      navigation={navigation}
      onNavigationHandled={onNavigationHandled}
    />
  );
}
