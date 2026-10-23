import express from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { initializeExperienceUpdater } from "./experience-updater";
import path from 'path';
import { createRequestLogger, requestErrorHandler } from "./http-middleware";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(createRequestLogger(log));

// Standardized global error handlers with process conflict prevention
let isShuttingDown = false;
let shutdownInitiatedAt = 0;

const handleCriticalError = (error: Error, source: string) => {
  const now = Date.now();
  console.error(`[${new Date().toISOString()}] CRITICAL ERROR (${source}):`, error.message);

  // Enhanced error logging with context
  const errorDetails: {
    message: string;
    name: string;
    source: string;
    timestamp: string;
    nodeVersion: string;
    memory: NodeJS.MemoryUsage;
    stack?: string;
  } = {
    message: error.message,
    name: error.name,
    source,
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    memory: process.memoryUsage(),
  };

  // Only log stack trace in development to save memory
  if (process.env.NODE_ENV === 'development' && error.stack) {
    console.error('Stack trace:', error.stack);
    errorDetails.stack = error.stack.split('\n').slice(0, 10).join('\n'); // Limit stack trace length
  }

  console.error('Error context:', JSON.stringify(errorDetails, null, 2));

  // Prevent multiple shutdown attempts within 5 seconds
  if (isShuttingDown) {
    const timeSinceShutdown = now - shutdownInitiatedAt;
    if (timeSinceShutdown < 5000) {
      console.error(`Shutdown already in progress for ${timeSinceShutdown}ms, ignoring`);
      return;
    } else {
      console.error('Previous shutdown failed, forcing exit');
      process.exit(1);
    }
  }

  isShuttingDown = true;
  shutdownInitiatedAt = now;

  // Graceful shutdown with timeout
  console.error('Initiating graceful shutdown due to critical error...');
  const shutdownTimeout = setTimeout(() => {
    console.error('Graceful shutdown timeout reached, forcing exit');
    process.exit(1);
  }, 3000);

  // Attempt graceful cleanup
  (async () => {
    try {
      const { closePool } = await import('./db');
      await closePool();
      clearTimeout(shutdownTimeout);
    } catch (cleanupError) {
      console.error('Error during cleanup:', cleanupError);
    } finally {
      process.exit(1);
    }
  })();
};

process.on('uncaughtException', (error) => {
  handleCriticalError(error, 'UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  error.message = `Unhandled Promise Rejection: ${error.message}`;
  handleCriticalError(error, 'UNHANDLED_REJECTION');
});

(async () => {
  const server = await registerRoutes(app);

  app.use("/api", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.status(404).json({ message: "Not found" });
  });

  // The sole public upload policy. Generated filenames and this whitelist make
  // uploads safe to serve; express.static provides byte-range video responses.
  const legacyUploadNames = new Set([
    "00bda27e82c295c535179c900.jpeg", "22b13c11fc7b4d4ef52e8ef01.jpg",
    "239ff9302338148f73f99e600.jpeg", "36e141d56ca7309dfa602de00.jpeg",
    "3d31b625051ac2680b52a6e00.jpeg", "Adam Dedmon.jpg",
    "b4390f67c494a0803e1ef0000.jpeg", "bc5a6e253fdd55ca82dc72500.jpeg",
    "Bill Harrison.jpg", "Brian Wilson.jpg", "Carl Elliott.jpg",
    "coach-dashboard-background.png", "Cody Jamerson.jpg", "Dwight Shelton.jpg",
    "e1cfea7399dd4c448b07e7700.jpg", "JakeBritt.jpg", "Jerimy Rinker.jpg",
    "JohnFaircloth.jpg", "Kyle Jamerson.jpg", "Kyle Randall.jpg",
    "Leigh Harris.jpg", "Mark Harris.jpeg", "Michael Fonte.jpg",
    "Nate Kreuter.jpg", "NateKreuter.jpg", "OfficialsBackground.png",
    "OfficialsSilhouette.png", "Regional-Supervisor-Dashboard.png",
    "Sean Soboleski.jpg", "Stall-image.png", "Steve Leight.jpg",
    "wrestlers-silhouette.png", "Zack Warfield.jpeg", "Zack Warfield.png",
  ]);
  app.use('/uploads', (req, res, next) => {
    let requestedName: string;
    try {
      requestedName = decodeURIComponent(req.path.slice(1));
    } catch (error) {
      return next(Object.assign(error as Error, { status: 400 }));
    }
    const isManagedAsset = /^[0-9a-f-]{36}\.(?:jpg|mp4|webm|mov|avi)$/i.test(requestedName);
    if (!isManagedAsset && !legacyUploadNames.has(requestedName)) {
      return res.sendStatus(404);
    }
    next();
  });
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads'), {
    setHeaders: (res, filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes: { [key: string]: string } = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mov': 'video/quicktime',
        '.avi': 'video/x-msvideo'
      };

      if (mimeTypes[ext]) {
        res.setHeader('Content-Type', mimeTypes[ext]);
      }

      // Set CORS headers for images
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Accept-Ranges', 'bytes');

      // Mobile-friendly cache headers - allow caching but make it revalidate
      res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
      res.setHeader('Vary', 'Accept-Encoding, User-Agent');
    },
    index: false,
    fallthrough: true
  }));

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Last in the stack so parser, API, upload, Vite and static errors all reach it.
  app.use(requestErrorHandler);

  // Initialize the automatic experience updater
  await initializeExperienceUpdater();

  // ALWAYS serve the app on port 5000
  // this serves both the API and the client
  const port = 5000;

  // Handle graceful shutdown with enhanced cleanup
  const shutdown = async () => {
    if (isShuttingDown) {
      log('Shutdown already in progress, ignoring signal');
      return;
    }

    isShuttingDown = true;
    log('Shutdown signal received, closing server gracefully');

    // Set shutdown timeout first
    const forceExitTimer = setTimeout(() => {
      log('Force exiting process due to timeout');
      process.exit(1);
    }, 5000);

    try {
      // Close server first to stop accepting new connections
      await new Promise<void>((resolve) => {
        server.close(() => {
          log('Server closed successfully');
          resolve();
        });
      });

      // Then close database pool
      const { closePool } = await import('./db');
      await closePool();
      log('Database pool closed successfully');

      // Clear the force exit timer
      clearTimeout(forceExitTimer);
      log('Graceful shutdown completed');
      process.exit(0);

    } catch (error) {
      log(`Error during shutdown: ${error instanceof Error ? error.message : String(error)}`);
      clearTimeout(forceExitTimer);
      process.exit(1);
    }
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGUSR1', shutdown);
  process.on('SIGUSR2', shutdown);

  // Additional cleanup for port conflicts
  process.on('exit', () => {
    log('Process exiting, cleanup complete');
  });

  // Enhanced port availability check with multiple methods
  const isPortAvailable = async (port: number): Promise<boolean> => {
    return new Promise(async (resolve) => {
      const { exec } = await import('child_process');

      // Try multiple commands to check port availability
      exec(`netstat -tulpn | grep :${port} 2>/dev/null || lsof -i:${port} 2>/dev/null || ss -tulpn | grep :${port} 2>/dev/null`, (error, stdout) => {
        const isAvailable = !stdout.trim();
        if (!isAvailable) {
          log(`Port ${port} is occupied by: ${stdout.trim().substring(0, 100)}`);
        }
        resolve(isAvailable);
      });
    });
  };

  // Aggressive port cleanup function
  const forceCleanupPort = async (port: number): Promise<void> => {
    const { exec } = await import('child_process');

    const commands = [
      `pkill -f "tsx server/index.ts" || true`,
      `pkill -f "node.*${port}" || true`,
      `fuser -k ${port}/tcp || true`,
      `pkill -f ":${port}" || true`,
      `lsof -ti:${port} | xargs kill -9 || true`
    ];

    for (const cmd of commands) {
      await new Promise<void>((resolve) => {
        exec(cmd, (error) => {
          // Always resolve, ignore errors since processes might not exist
          resolve();
        });
      });
      // Small delay between commands
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  };

  // Start server with enhanced port conflict resolution and cleanup
  const startServer = async (retries = 7) => {
    for (let i = 0; i < retries; i++) {
      try {
        // Check port availability first
        const portAvailable = await isPortAvailable(port);
        if (!portAvailable && i === 0) {
          log(`Port ${port} is in use, initiating cleanup...`);
        }
        // Enhanced port cleanup before attempting to bind
        if (i > 0) {
          log(`Attempting aggressive port cleanup for ${port} (attempt ${i + 1}/${retries})...`);
          try {
            await forceCleanupPort(port);
            // Longer wait for cleanup to complete
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Verify cleanup worked
            const stillOccupied = !(await isPortAvailable(port));
            if (stillOccupied) {
              log(`Port ${port} still occupied after cleanup attempt ${i + 1}`);
            } else {
              log(`Port ${port} successfully cleaned up`);
            }

          } catch (cleanupError) {
            log(`Port cleanup error: ${cleanupError instanceof Error ? cleanupError.message : 'Unknown error'}`);
          }
        }

        await new Promise<void>((resolve, reject) => {
          const serverInstance = server.listen(port, "0.0.0.0", () => {
            log(`🚀 SERVER READY - serving on http://0.0.0.0:${port}`);
            log(`🌐 Preview available at: http://0.0.0.0:${port}`);
            resolve();
          }).on('error', (err: any) => {
            if (err.code === 'EADDRINUSE') {
              log(`❌ Port ${port} conflict detected on attempt ${i + 1}/${retries}`);
              reject(new Error(`Port ${port} is in use`));
            } else {
              log(`❌ Server error: ${err.message}`);
              reject(err);
            }
          });
        });
        return; // Success, exit the function
      } catch (err: any) {
        if (err.message.includes('Port') && i < retries - 1) {
          const waitTime = Math.min((i + 1) * 2, 10); // Cap wait time at 10 seconds
          log(`Port ${port} is in use. Waiting ${waitTime} seconds before retry ${i + 2}/${retries}...`);
          await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
        } else if (i === retries - 1) {
          log('Failed to start server after multiple attempts. Exiting.');
          process.exit(1);
        } else {
          log(`Server error: ${err.message}`);
          process.exit(1);
        }
      }
    }
  };

  await startServer();
})();