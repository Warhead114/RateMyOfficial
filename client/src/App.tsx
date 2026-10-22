import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Redirect, Route, Switch } from "wouter";
import { Toaster } from "@/components/ui/toaster";
import Layout from "@/pages/layout";
import ErrorBoundary from "@/components/ErrorBoundary";

// Import pages
import Home from "@/pages/home";
import Officials from "@/pages/officials";
import OfficialDetail from "@/pages/official";
import Events from "@/pages/events";
import EventDetail from "@/pages/event-detail";
import EventEdit from "@/pages/event-edit";
import OfficialReview from "@/pages/official-review";
import Login from "@/pages/auth/login";
import ForgotPassword from "@/pages/auth/forgot-password";
import ResetPassword from "@/pages/auth/reset-password";
import Register from "@/pages/auth/register";
import AdminDashboard from "@/pages/admin";
import AdminLogin from "@/pages/admin/admin-login";
import PendingUsers from "@/pages/admin/pending-users";
import AddOfficialForm from "@/pages/admin/add-official-form";
import AddEventForm from "@/pages/admin/add-event-form";
import EditOfficialForm from "@/pages/admin/edit-official-form";
import EditSupervisorForm from "@/pages/admin/edit-supervisor-form";
// Removed: import AdminSettings from "@/pages/admin/settings";

import ManageTeams from "@/pages/admin/manage-teams";
import ManageCoaches from "@/pages/admin/manage-coaches";
import SupervisorDashboard from "@/pages/supervisor";
import SupervisorPendingUsers from "@/pages/supervisor/pending-users";
import SupervisorManageCoaches from "@/pages/supervisor/manage-coaches";
import SupervisorProfileEdit from "@/pages/supervisor/profile-edit";
import SupervisorSettings from "@/pages/supervisor/settings";
import CoachDashboard from "@/pages/coach";
import CoachProfileEdit from "@/pages/coach/profile-edit";
import CoachEditForm from "@/pages/coach/edit-coach-form";
import CoachSettings from "@/pages/coach/settings";
import OfficialsDashboard from "@/pages/officials-dashboard";
import NotFound from "@/pages/not-found";

// Use the optimized queryClient from lib/queryClient.ts to prevent duplicate instances
import { queryClient } from "@/lib/queryClient";

function AppContent() {
  return (
    <ErrorBoundary>
      <Layout>
        <Switch>
        <Route path="/" component={Home} />
        <Route path="/officials" component={Officials} />
        <Route path="/officials/:slug" component={OfficialDetail} />
        <Route path="/officials/:slug/review" component={OfficialReview} />
        <Route path="/events" component={Events} />
        <Route path="/events/:id" component={EventDetail} />
        <Route path="/events/:id/edit" component={EventEdit} />
        <Route path="/login" component={Login} />
        <Route path="/forgot-password" component={ForgotPassword} />
        <Route path="/reset-password" component={ResetPassword} />
        <Route path="/register" component={Register} />
        <Route path="/admin" component={AdminDashboard} />
        <Route path="/admin/login" component={AdminLogin} />
        <Route path="/admin/pending-users" component={PendingUsers} />
        <Route path="/admin/add-official" component={AddOfficialForm} />
        <Route path="/admin/add-event" component={AddEventForm} />
        <Route path="/admin/edit-official/:id" component={EditOfficialForm} />
        <Route path="/admin/supervisors/:id/edit" component={EditSupervisorForm} />
        <Route path="/admin/officials/:id/edit" component={EditOfficialForm} />
        <Route path="/admin/coaches/:id/edit" component={() => <Redirect to="/admin/coaches" />} />
        {/* Removed: <Route path="/admin/settings" component={AdminSettings} /> */}
        <Route path="/admin/teams" component={ManageTeams} />
        <Route path="/admin/coaches" component={ManageCoaches} />
        <Route path="/supervisor" component={SupervisorDashboard} />
        <Route path="/supervisor/pending-users" component={SupervisorPendingUsers} />
        <Route path="/supervisor/coaches" component={SupervisorManageCoaches} />
        <Route path="/supervisor/profile" component={() => <Redirect to="/supervisor" />} />
        <Route path="/supervisor/:id/edit" component={EditSupervisorForm} />
        <Route path="/supervisor/settings" component={SupervisorSettings} />
        <Route path="/coach" component={CoachDashboard} />
        <Route path="/coach/profile" component={() => <Redirect to="/coach" />} />
        <Route path="/coach/:id/edit" component={CoachEditForm} />
        <Route path="/coach/settings" component={CoachSettings} />
        <Route path="/officials-dashboard" component={OfficialsDashboard} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
    </ErrorBoundary>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AppContent />
      </QueryClientProvider>
      <Toaster />
    </ErrorBoundary>
  );
}

export default App;