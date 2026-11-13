import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let w = UIWindow(frame: UIScreen.main.bounds)
        w.backgroundColor = .black
        w.rootViewController = ViewController()
        w.makeKeyAndVisible()
        window = w
        application.isIdleTimerDisabled = true   // no screen dimming while playing
        return true
    }
}