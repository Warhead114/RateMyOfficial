#!/bin/bash

# Ensure the uploads directory exists
mkdir -p uploads

# Start the application
NODE_ENV=production node dist/index.js