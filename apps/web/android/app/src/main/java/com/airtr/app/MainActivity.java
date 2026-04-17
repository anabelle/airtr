package com.airtr.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import android.os.Bundle;

import androidx.annotation.Nullable;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // These same channels are also created from PushNotifications.createChannel in
        // provider.tsx. The duplication is intentional and safe because
        // createNotificationChannel is idempotent, which guarantees channels exist
        // regardless of whether native or JS initialization happens first.
        createNotificationChannels();
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }

        NotificationChannel critical = new NotificationChannel(
            "acars-critical",
            "Critical finance",
            NotificationManager.IMPORTANCE_HIGH
        );
        critical.setDescription("Bankruptcy filings and severe financial warnings.");

        NotificationChannel competition = new NotificationChannel(
            "acars-competition",
            "Competition",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        competition.setDescription("Competitor hub moves and price wars.");

        NotificationChannel progression = new NotificationChannel(
            "acars-progression",
            "Progression",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        progression.setDescription("Tier upgrades and major purchases or sales.");

        NotificationChannel operations = new NotificationChannel(
            "acars-operations",
            "Operations",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        operations.setDescription("Deliveries, maintenance, ferry flights, takeoffs, and landings.");

        manager.createNotificationChannel(critical);
        manager.createNotificationChannel(competition);
        manager.createNotificationChannel(progression);
        manager.createNotificationChannel(operations);
    }
}
