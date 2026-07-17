<?php
header('Content-Type: application/json');

// Set cache control for the API responses
header('Cache-Control: no-store, no-cache, must-revalidate, private');

$action = isset($_GET['action']) ? $_GET['action'] : '';
$sessionFile = 'session.json';
$indexFile = 'index.html';
$sessionTimeout = 12; // 12 seconds

function getActiveSession() {
    global $sessionFile;
    if (file_exists($sessionFile)) {
        $data = json_decode(file_get_contents($sessionFile), true);
        if (json_last_error() === JSON_ERROR_NONE) {
            return $data;
        }
    }
    return [
        'sessionId' => null,
        'deviceName' => null,
        'ip' => null,
        'lastSeen' => 0
    ];
}

function saveActiveSession($session) {
    global $sessionFile;
    file_put_contents($sessionFile, json_encode($session));
}

$rawInput = file_get_contents('php://input');
$input = json_decode($rawInput, true);

if ($action === 'session-check') {
    $username = isset($input['username']) ? $input['username'] : '';
    $deviceName = isset($input['deviceName']) ? $input['deviceName'] : '';
    $sessionId = isset($input['sessionId']) ? $input['sessionId'] : '';
    
    $now = time() * 1000; // milliseconds
    $clientIp = isset($_SERVER['HTTP_X_FORWARDED_FOR']) ? $_SERVER['HTTP_X_FORWARDED_FOR'] : $_SERVER['REMOTE_ADDR'];
    
    $active = getActiveSession();
    $isAnotherActive = $active['sessionId'] && 
                        $active['sessionId'] !== $sessionId && 
                        ($now - $active['lastSeen'] < $sessionTimeout * 1000);
                        
    if ($isAnotherActive) {
        echo json_encode([
            'status' => 'conflict',
            'deviceName' => $active['deviceName'],
            'ip' => $active['ip']
        ]);
    } else {
        $active['sessionId'] = $sessionId;
        $active['deviceName'] = $deviceName;
        $active['ip'] = $clientIp;
        $active['lastSeen'] = $now;
        saveActiveSession($active);
        echo json_encode(['status' => 'ok']);
    }
    exit;
}

if ($action === 'session-heartbeat') {
    $sessionId = isset($input['sessionId']) ? $input['sessionId'] : '';
    $deviceName = isset($input['deviceName']) ? $input['deviceName'] : '';
    $now = time() * 1000;
    
    $active = getActiveSession();
    if ($active['sessionId'] === $sessionId) {
        $active['lastSeen'] = $now;
        saveActiveSession($active);
        echo json_encode(['status' => 'ok']);
    } else {
        $isAnotherActive = $active['sessionId'] && 
                            ($now - $active['lastSeen'] < $sessionTimeout * 1000);
                            
        if ($isAnotherActive) {
            echo json_encode([
                'status' => 'expired_conflict',
                'deviceName' => $active['deviceName'],
                'ip' => $active['ip']
            ]);
        } else {
            $clientIp = isset($_SERVER['HTTP_X_FORWARDED_FOR']) ? $_SERVER['HTTP_X_FORWARDED_FOR'] : $_SERVER['REMOTE_ADDR'];
            $active['sessionId'] = $sessionId;
            $active['deviceName'] = $deviceName;
            $active['ip'] = $clientIp;
            $active['lastSeen'] = $now;
            saveActiveSession($active);
            echo json_encode(['status' => 'ok']);
        }
    }
    exit;
}

if ($action === 'session-logout') {
    $sessionId = isset($input['sessionId']) ? $input['sessionId'] : '';
    $active = getActiveSession();
    if ($active['sessionId'] === $sessionId) {
        $active = [
            'sessionId' => null,
            'deviceName' => null,
            'ip' => null,
            'lastSeen' => 0
        ];
        saveActiveSession($active);
    }
    echo json_encode(['status' => 'ok']);
    exit;
}

if ($action === 'save-content') {
    $sessionId = isset($input['sessionId']) ? $input['sessionId'] : '';
    $htmlContent = isset($input['htmlContent']) ? $input['htmlContent'] : '';
    
    $now = time() * 1000;
    $active = getActiveSession();
    $isAuthorized = $active['sessionId'] === $sessionId && 
                     ($now - $active['lastSeen'] < $sessionTimeout * 1000);
                     
    if (!$isAuthorized) {
        http_response_code(403);
        echo json_encode(['status' => 'unauthorized', 'message' => 'Session expired or not authorized']);
        exit;
    }
    
    if (!file_exists($indexFile)) {
        http_response_code(500);
        echo json_encode(['status' => 'error', 'message' => 'index.html not found']);
        exit;
    }
    
    $data = file_get_contents($indexFile);
    $startMarker = '<!-- START CONTENT CONTAINER -->';
    $endMarker = '<!-- END CONTENT CONTAINER -->';
    
    $startIndex = strpos($data, $startMarker);
    $endIndex = strpos($data, $endMarker);
    
    if ($startIndex === false || $endIndex === false) {
        http_response_code(500);
        echo json_encode(['status' => 'error', 'message' => 'HTML boundary markers not found']);
        exit;
    }
    
    $updatedHtml = substr($data, 0, $startIndex + strlen($startMarker)) . 
                   "\n" . $htmlContent . "\n" . 
                   substr($data, $endIndex);
                   
    if (file_put_contents($indexFile, $updatedHtml) !== false) {
        echo json_encode(['status' => 'ok']);
    } else {
        http_response_code(500);
        echo json_encode(['status' => 'error', 'message' => 'Failed to write to index.html']);
    }
    exit;
}

// Default fallback
http_response_code(404);
echo json_encode(['status' => 'error', 'message' => 'Action not found']);
?>