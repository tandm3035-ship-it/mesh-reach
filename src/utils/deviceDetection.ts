// Device Detection Utilities
// Extracts meaningful device names from user agent and platform info

interface DeviceInfo {
  name: string;
  type: 'phone' | 'tablet' | 'laptop' | 'desktop' | 'unknown';
  brand: string;
  model: string;
  os: string;
}

/**
 * Detects device information from browser APIs
 */
export function detectDeviceInfo(): DeviceInfo {
  const ua = navigator.userAgent;
  const platform = navigator.platform || '';
  
  let brand = 'Unknown';
  let model = '';
  let type: DeviceInfo['type'] = 'unknown';
  let os = '';
  let name = '';

  // Detect OS
  if (/Android/i.test(ua)) {
    os = 'Android';
    type = 'phone';
    
    // Try to get Android device model
    const androidMatch = ua.match(/Android\s[\d.]+;\s*([^;)]+)/);
    if (androidMatch) {
      model = androidMatch[1].trim();
    }
    
    // Detect Samsung
    if (/Samsung|SM-|SAMSUNG|Galaxy/i.test(ua)) {
      brand = 'Samsung';
      const galaxyMatch = ua.match(/Galaxy\s*(\w+)/i) || ua.match(/SM-([A-Z]\d+)/i);
      if (galaxyMatch) {
        model = `Galaxy ${galaxyMatch[1]}`;
      }
    }
    // Detect Xiaomi
    else if (/Xiaomi|Mi\s|Redmi|POCO/i.test(ua)) {
      brand = 'Xiaomi';
      const miMatch = ua.match(/(Mi\s*\d+|Redmi\s*[\w\s]+|POCO\s*[\w]+)/i);
      if (miMatch) model = miMatch[1].trim();
    }
    // Detect OnePlus
    else if (/OnePlus/i.test(ua)) {
      brand = 'OnePlus';
      const opMatch = ua.match(/OnePlus\s*(\w+)/i);
      if (opMatch) model = opMatch[1];
    }
    // Detect Huawei
    else if (/Huawei|HUAWEI/i.test(ua)) {
      brand = 'Huawei';
      const hwMatch = ua.match(/HUAWEI\s*([^;)]+)/i);
      if (hwMatch) model = hwMatch[1].trim();
    }
    // Detect Google Pixel
    else if (/Pixel/i.test(ua)) {
      brand = 'Google';
      const pixelMatch = ua.match(/Pixel\s*(\d+\s*\w*)/i);
      if (pixelMatch) model = `Pixel ${pixelMatch[1].trim()}`;
    }
    // Detect Oppo
    else if (/OPPO/i.test(ua)) {
      brand = 'OPPO';
      const oppoMatch = ua.match(/OPPO\s*([^;)]+)/i);
      if (oppoMatch) model = oppoMatch[1].trim();
    }
    // Detect Vivo
    else if (/vivo/i.test(ua)) {
      brand = 'Vivo';
      const vivoMatch = ua.match(/vivo\s*([^;)]+)/i);
      if (vivoMatch) model = vivoMatch[1].trim();
    }
    // Generic Android device name extraction
    else if (model) {
      const parts = model.split(' ');
      if (parts.length > 0) {
        brand = parts[0];
        model = parts.slice(1).join(' ') || model;
      }
    }
    
    // Check if tablet
    if (/Tablet|Tab|Pad/i.test(ua) || (!/Mobile/i.test(ua) && /Android/i.test(ua))) {
      type = 'tablet';
    }
    
  } else if (/iPhone/i.test(ua)) {
    brand = 'Apple';
    os = 'iOS';
    type = 'phone';
    model = 'iPhone';
    
  } else if (/iPad/i.test(ua)) {
    brand = 'Apple';
    os = 'iPadOS';
    type = 'tablet';
    model = 'iPad';
    
  } else if (/Macintosh|Mac OS X/i.test(ua)) {
    brand = 'Apple';
    os = 'macOS';
    type = 'laptop';
    model = 'Mac';
    
    // Try to detect specific Mac model from UA
    if (/MacBook/i.test(ua)) {
      model = 'MacBook';
    } else if (/iMac/i.test(ua)) {
      model = 'iMac';
      type = 'desktop';
    }
    
  } else if (/Windows/i.test(ua)) {
    brand = 'Windows';
    os = 'Windows';
    
    // Detect Windows version
    if (/Windows NT 10/i.test(ua)) {
      os = 'Windows 10/11';
    }
    
    // Check if touch device (might be tablet)
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
      type = 'tablet';
      model = 'PC';
    } else {
      type = 'desktop';
      model = 'PC';
    }
    
  } else if (/Linux/i.test(ua)) {
    brand = 'Linux';
    os = 'Linux';
    type = 'desktop';
    model = 'PC';
    
  } else if (/CrOS/i.test(ua)) {
    brand = 'Chrome';
    os = 'ChromeOS';
    type = 'laptop';
    model = 'Chromebook';
  }

  // Build the device name
  if (brand && model) {
    name = `${brand} ${model}`.trim();
  } else if (brand) {
    name = brand;
  } else if (model) {
    name = model;
  } else {
    name = `${os || 'Unknown'} Device`;
  }
  
  // Clean up the name
  name = name.replace(/\s+/g, ' ').trim();
  
  // Limit name length
  if (name.length > 30) {
    name = name.substring(0, 27) + '...';
  }

  return {
    name,
    type,
    brand,
    model,
    os
  };
}

/**
 * Gets a short device identifier for display
 */
export function getShortDeviceId(deviceId: string): string {
  return deviceId.slice(0, 4).toUpperCase();
}

/**
 * Gets a friendly device name, using actual device info if available
 */
export function getFriendlyDeviceName(deviceId: string): string {
  const info = detectDeviceInfo();
  
  // If we got a meaningful name, use it
  if (info.name && info.name !== 'Unknown Device') {
    return info.name;
  }
  
  // Fallback to generic name with ID
  return `Device-${getShortDeviceId(deviceId)}`;
}

/**
 * Parse device name from stored string (for when we get names from other devices)
 */
export function parseDeviceName(storedName: string | undefined, deviceId: string): string {
  if (storedName && storedName !== `MeshUser-${deviceId.slice(0, 4)}`) {
    return storedName;
  }
  
  return `Device-${getShortDeviceId(deviceId)}`;
}