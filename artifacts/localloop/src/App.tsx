import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider } from '@/lib/auth';
import { Shell } from '@/components/localloop';
import {
  AdminPage, AttendeesPage, AuthPage, DashboardPage, EventDetailPage, EventFormPage,
  ExplorePage, HomePage, MyEventsPage, NotFoundPage, ProfileEditPage, ProfilePage, SavedPage,
} from '@/pages/loop-pages';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Shell>
        <Switch>
          <Route path="/" component={HomePage} />
          <Route path="/explore" component={ExplorePage} />
          <Route path="/events/new" component={EventFormPage} />
          <Route path="/events/:id/edit" component={EventFormPage} />
          <Route path="/events/:id/attendees" component={AttendeesPage} />
          <Route path="/events/:id" component={EventDetailPage} />
          <Route path="/my-events" component={MyEventsPage} />
          <Route path="/saved" component={SavedPage} />
          <Route path="/profile/edit" component={ProfileEditPage} />
          <Route path="/profile" component={ProfilePage} />
          <Route path="/dashboard" component={DashboardPage} />
          <Route path="/organizer" component={DashboardPage} />
          <Route path="/admin" component={AdminPage} />
          <Route path="/login">{() => <AuthPage mode="login" />}</Route>
          <Route path="/signup">{() => <AuthPage mode="signup" />}</Route>
          <Route path="/forgot-password">{() => <AuthPage mode="recover" />}</Route>
          <Route component={NotFoundPage} />
        </Switch>
      </Shell>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <AuthProvider>
            <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
