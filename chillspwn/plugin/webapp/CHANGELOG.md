# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project intends to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once its first release is defined.

## [Unreleased]

### Added

- Professional repository documentation, community health files, CI validation, and dependency-update configuration.

### Changed

- Standardized the JavaScript dependency contract on Bun.
- Made deployment-specific Capacitor server configuration environment-driven and secure by default.

### Security

- Expanded ignore rules for local credentials, tunnel state, scanner output, and engagement artifacts.
- Removed unreferenced public QR/prototype artifacts containing private deployment and lab examples.
- Replaced credential-shaped current test fixtures with runtime-assembled synthetic values.
- Updated compatible dependencies to resolve known audit findings.
