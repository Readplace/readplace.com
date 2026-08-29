---
name: ios-simulator
description: Run the Readplace iOS app in a Simulator and see its screen. Use when opening, launching, screenshotting, or recording the app in a Simulator, or when the Simulator window is black, missing, or titled "External Display".
---

# Running the app in a Simulator

```bash
(cd projects/hutch && pnpm dev) &            # the build below talks to http://127.0.0.1:3000
cd projects/native-apps/ios
make run-local                               # LOCAL_SERVER build: boots the newest iPhone simulator, installs, launches
D=$(xcrun simctl list devices booted | grep -m1 -oE '[0-9A-F-]{36}')   # the device make just booted
```

Every Xcode/`swiftc` invocation goes through `./scripts/xc.sh` — it scrubs the devbox/nix
toolchain, without which the SDK mismatches and the build dies.

Optional polish before capturing anything:

```bash
xcrun simctl status_bar "$D" override --time "9:41" --dataNetwork wifi --wifiMode active \
  --wifiBars 3 --cellularMode active --cellularBars 4 --batteryState discharging --batteryLevel 100
```

## Seeing the screen

`xcrun simctl io "$D" screenshot out.png` captures the device framebuffer and needs no window
at all — prefer it. It also ignores whatever is stacked on top of the Simulator, which matters
because a background process cannot reliably raise the Simulator window while someone is using
the Mac.

To record: `xcrun simctl io "$D" recordVideo --codec h264 out.mp4`, stopped with
`pkill -INT -f "simctl io $D recordVideo"`. Killing the wrapper without SIGINT to the child
leaves a recorder registered and every later attempt fails `Resource busy`; only
`killall -9 com.apple.CoreSimulator.CoreSimulatorService` clears that.

## The window is black and titled "… – External Display"

`SimulatorExternalDisplay` is set per device in `com.apple.iphonesimulator`, and a device booted
while it is set attaches a second framebuffer and opens *that* as its window. Clearing the
preference does not fix the affected device: Simulator holds the value in memory and writes it
back on relaunch, so the device keeps opening the phantom.

Switch to a device that does not have it set. Confirm before spending time on it:

```bash
xcrun simctl io "$D" enumerate | grep -A4 "Class: Display" | grep "Default width"
```

Two widths means the phantom is attached — one is the device (e.g. `1206`), the other is the
external display (e.g. `720`). One width means the device is clean.
