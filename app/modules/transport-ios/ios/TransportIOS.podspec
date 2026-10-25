Pod::Spec.new do |s|
  s.name           = 'TransportIOS'
  s.version        = '1.0.0'
  s.summary        = 'Widget data and the trip Live Activity for Transport: Sydney Live'
  s.description    = 'Writes shared widget data to the app group, reloads widgets and runs the trip Live Activity.'
  s.author         = 'Fintex Australia Pty Ltd'
  s.homepage       = 'https://fintex.au'
  s.license        = { :type => 'Proprietary' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.swift_version  = '5.9'
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'WidgetKit', 'WatchConnectivity'
  s.weak_frameworks = 'ActivityKit'
  s.source_files   = '**/*.swift'
end
