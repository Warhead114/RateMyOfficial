import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import Layout from "@/pages/layout";
import Home from "@/pages/home";
import Official from "@/pages/official";
import OfficialReview from "@/pages/official-review";
import Events from "@/pages/events";
import EventEdit from "@/pages/event-edit";
import EventDetail from "@/pages/event-detail";
import Admin from "@/pages/admin";
import AdminLogin from "@/pages/admin/admin-login";
import EditOfficialForm from "@/pages/admin/edit-official-form";
import AdminSettings from "@/pages/admin/settings";
import Supervisor from "@/pages/supervisor";
import SupervisorSettings from "@/pages/supervisor/settings";
import Coach from "@/pages/coach";
import CoachSettings from "@/pages/coach/settings";
import Register from "@/pages/auth/register";
import Login from "@/pages/auth/login";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/officials/:id" component={Official} />
        <Route path="/officials/:id/review" component={OfficialReview} />
        <Route path="/events" component={Events} />
        <Route path="/events/:id" component={EventDetail} />
        <Route path="/events/:id/edit" component={EventEdit} />
        <Route path="/admin" component={Admin} />
        <Route path="/admin/login" component={AdminLogin} />
        <Route path="/admin/officials/:id/edit" component={EditOfficialForm} />
        <Route path="/admin/settings" component={AdminSettings} />
        <Route path="/supervisor" component={Supervisor} />
        <Route path="/supervisor/officials/:id/edit" component={EditOfficialForm} />
        <Route path="/supervisor/settings" component={SupervisorSettings} />
        <Route path="/coach" component={Coach} />
        <Route path="/coach/settings" component={CoachSettings} />
        <Route path="/register" component={Register} />
        <Route path="/login" component={Login} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router />
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;