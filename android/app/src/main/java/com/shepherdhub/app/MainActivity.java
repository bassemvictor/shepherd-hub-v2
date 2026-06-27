package com.shepherdhub.app;

import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getOnBackPressedDispatcher()
            .addCallback(
                this,
                new OnBackPressedCallback(true) {
                    @Override
                    public void handleOnBackPressed() {
                        if (bridge == null) {
                            finish();
                            return;
                        }

                        bridge.triggerDocumentJSEvent("backbutton");
                    }
                }
            );
    }

    @Override
    public void onBackPressed() {
        if (bridge == null) {
            super.onBackPressed();
            return;
        }

        bridge.triggerDocumentJSEvent("backbutton");
    }
}
