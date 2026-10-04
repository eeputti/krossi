// screens.js — route name -> screen component. Every screen receives { params, query, route }.
import { HomeScreen } from '../screens/home/HomeScreen.jsx';
import { GamesScreen } from '../screens/games/GamesScreen.jsx';
import { GameScreen } from '../screens/games/GameScreen.jsx';
import { CreateGameSheet } from '../screens/games/CreateGameSheet.jsx';
import { PlayersScreen } from '../screens/players/PlayersScreen.jsx';
import { PlayerScreen } from '../screens/players/PlayerScreen.jsx';
import { PartnersScreen } from '../screens/players/PartnersScreen.jsx';
import { InboxScreen } from '../screens/messages/InboxScreen.jsx';
import { ChatScreen } from '../screens/messages/ChatScreen.jsx';
import { ArchiveScreen } from '../screens/messages/ArchiveScreen.jsx';
import { ProfileScreen } from '../screens/profile/ProfileScreen.jsx';
import { ProfileEditScreen } from '../screens/profile/ProfileEditScreen.jsx';
import { SettingsScreen } from '../screens/profile/SettingsScreen.jsx';
import { BlockedScreen } from '../screens/profile/BlockedScreen.jsx';
import { BadgesScreen } from '../screens/profile/BadgesScreen.jsx';
import { RecapScreen } from '../screens/recap/RecapScreen.jsx';
import { LeaguesScreen } from '../screens/leagues/LeaguesScreen.jsx';
import { LeagueScreen } from '../screens/leagues/LeagueScreen.jsx';
import { InviteScreen } from '../screens/auth/InviteScreen.jsx';
import { AdminScreen } from '../screens/admin/AdminScreen.jsx';
import { EmptyState, Button, Page } from '../ui/index.js';
import { navigate } from './router.js';

export const SCREENS = {
  home: HomeScreen,
  games: GamesScreen,
  game: GameScreen,
  createGame: CreateGameSheet,
  players: PlayersScreen,
  player: PlayerScreen,
  partners: PartnersScreen,
  inbox: InboxScreen,
  chat: ChatScreen,
  archive: ArchiveScreen,
  profile: ProfileScreen,
  profileEdit: ProfileEditScreen,
  settings: SettingsScreen,
  blocked: BlockedScreen,
  badges: BadgesScreen,
  recap: RecapScreen,
  leagues: LeaguesScreen,
  league: LeagueScreen,
  invite: InviteScreen,
  admin: AdminScreen,
};

export function NotFoundScreen() {
  return (
    <Page>
      <EmptyState
        art="search"
        title="Tätä sivua ei löytynyt"
        text="Linkki voi olla vanha tai kirjoitusvirhe osoitteessa."
        action={<Button variant="dark" onClick={() => navigate('/pelaa/koti', { replace: true })}>Takaisin kotiin</Button>}
      />
    </Page>
  );
}
