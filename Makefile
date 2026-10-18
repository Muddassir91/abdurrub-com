.PHONY: setup project open test build-mac build-ios ci

setup:
	@command -v xcodegen >/dev/null || brew install xcodegen
	@test -f Config/Local.xcconfig || cp Config/Local.xcconfig.example Config/Local.xcconfig
	@echo "Now edit Config/Local.xcconfig and set DEVELOPMENT_TEAM, then run: make open"

project:
	xcodegen generate

open: project
	open Kalaam.xcodeproj

test:
	swift test --package-path Packages/KalaamKit

build-mac: project
	xcodebuild -project Kalaam.xcodeproj -scheme KalaamMac -destination 'generic/platform=macOS' CODE_SIGNING_ALLOWED=NO -quiet build

build-ios: project
	xcodebuild -project Kalaam.xcodeproj -scheme KalaamiOS -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO -quiet build

ci: test build-mac build-ios
