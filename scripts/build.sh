#!/bin/bash

# Run the build process
npm run build

# Create uploads directory if it doesn't exist
mkdir -p uploads

# Ensure scripts are executable
chmod +x scripts/*.sh