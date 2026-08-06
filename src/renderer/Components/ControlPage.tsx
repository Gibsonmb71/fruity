import { ControlPages } from '../Enums';
import { ReadinessTarget } from '../Services/TournamentReadiness';
import RoomsPage from './Rooms/RoomsPage';

interface IControlPageProps {
  section: ControlPages;
  onSectionChange: (section: ControlPages) => void;
  onNavigateTarget: (target: ReadinessTarget) => void;
}

/** The tournament-day operations area. RoomsPage owns the existing server workflows and dialogs. */
export default function ControlPage({ section, onSectionChange, onNavigateTarget }: IControlPageProps) {
  return <RoomsPage activeTab={section} onTabChange={onSectionChange} onNavigateTarget={onNavigateTarget} />;
}
