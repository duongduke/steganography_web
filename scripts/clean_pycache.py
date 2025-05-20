#!/usr/bin/env python
# -*- coding: utf-8 -*-

import os

def clean_pycache_contents():
    """Remove only the contents of __pycache__ directory, but keep the directory itself"""
    
    # Get scripts directory path
    scripts_dir = os.path.dirname(os.path.abspath(__file__))
    
    # Path to __pycache__ folder
    pycache_path = os.path.join(scripts_dir, '__pycache__')
    
    # Check if __pycache__ exists
    if os.path.exists(pycache_path) and os.path.isdir(pycache_path):
        # Get list of files in __pycache__
        files = os.listdir(pycache_path)
        
        if not files:
            print("__pycache__ is already empty.")
            return
        
        # Delete each file
        deleted_count = 0
        for filename in files:
            file_path = os.path.join(pycache_path, filename)
            if os.path.isfile(file_path):
                try:
                    os.remove(file_path)
                    deleted_count += 1
                except Exception as e:
                    print(f"Error deleting {filename}: {e}")
        
        print(f"Cleaned {deleted_count} files from __pycache__ directory.")
    else:
        print("__pycache__ directory not found.")

if __name__ == "__main__":
    clean_pycache_contents() 