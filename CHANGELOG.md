# Changelog

All notable changes to this recovery repository will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Application releases intend to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once a first release is defined; recovery snapshots use dated tags.

## [Unreleased]

### Added

- Root repository documentation, contribution guidance, issue and pull-request templates, CI validation, and dependency-update configuration.
- Current ChillsPwn application documentation, tests, and Grok ACP commander-boundary components.

### Changed

- Refreshed the ChillsPwn application source from the maintained working tree.
- Updated recovery validation for OAuth-backed Grok ACP Expert mode, commander delegation policy, and fail-closed attestation.
- Standardized the current web dependency contract on Bun.

### Security

- Removed generated QR, prototype, and Android web assets that contained private deployment details.
- Kept provider authentication stores, API credentials, operational databases, logs, memories, and engagement data outside the repository.

## Recovery snapshots

Historical recovery tags are retained for disaster-recovery provenance. No prior semantic release history is claimed here.
