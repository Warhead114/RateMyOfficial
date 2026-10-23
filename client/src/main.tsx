import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { queryClient } from "@/lib/queryClient";

// Add global error handlers
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  // Prevent the default behavior (which would crash the app)
  event.preventDefault();
});

window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
});

// Analysis scripts disabled to prevent browser memory bloat
// These can be re-enabled individually for debugging if needed
// import { runFullAnalysis } from "@/lib/create-add-analysis";
// import "@/lib/test-add-official";
// import "@/lib/server-analysis";
// import "@/lib/comprehensive-test";
// import { runFourthAnalysis } from './lib/fourth-analysis';
// import { runEndpointValidation } from './lib/endpoint-validation';

// Minimal production-ready initialization
console.log('🚀 RateMyOfficial Application Initialized');

createRoot(document.getElementById("root")!).render(<App />);